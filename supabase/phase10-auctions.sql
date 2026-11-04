-- =====================================================================
--  MHC Diecast — Auctions  (mhcdiecast.com/auction)
--  Run ONCE in Supabase → SQL Editor, after phase8-buyers.sql.
--  Safe to run again.
--
--  Rules enforced here (the website can't bypass them):
--   • Only signed-in (Google) users can start auctions or bid.
--   • Start: 1 photo, title, starting bid ≥ ₹1, min increment ≥ ₹1,
--     optional Buy-Now above the starting bid, end time 15 min – 30 days ahead.
--   • A bid is accepted only if the auction is live, the end time has not
--     passed (server clock), the bidder isn't the seller or already the
--     highest bidder, and the amount ≥ current bid + min increment
--     (or ≥ starting bid for the first bid). Everything else is rejected.
--   • Bids are processed one at a time per auction (row lock), so two
--     people bidding the same amount at the same moment can't both win.
--   • Anti-sniping: in the final 2 minutes each new bid must be at least
--     ₹100 higher (or the seller's increment if bigger), and every such bid
--     resets the clock to 2 minutes. Bidding ends after 2 quiet minutes.
--   • At the end time bidding closes automatically; the highest bidder wins.
--     Buy-Now ends the auction immediately.
--   • Bidders are shown by their Google name.
-- =====================================================================

-- ---------- 1. Tables ---------------------------------------------------
create table if not exists public.auctions (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references auth.users(id) on delete cascade,
  seller_name     text not null,
  seller_whatsapp text not null check (seller_whatsapp ~ '^[6-9][0-9]{9}$'),
  title           text not null check (length(title) between 3 and 80),
  description     text check (description is null or length(description) <= 600),
  photo_path      text not null,                 -- file in the 'auction-photos' bucket
  start_price     int  not null check (start_price between 1 and 1000000),
  min_increment   int  not null check (min_increment between 1 and 100000),
  buy_now_price   int  check (buy_now_price is null or buy_now_price > start_price),
  end_time        timestamptz not null,
  status          text not null default 'live' check (status in ('live','sold','cancelled','removed')),
  current_bid     int,
  current_bidder  uuid references auth.users(id) on delete set null,
  current_bidder_label text,
  bid_count       int  not null default 0,
  extensions      int  not null default 0,          -- times the end was pushed by late bids
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.auctions add column if not exists extensions int not null default 0;
create index if not exists auctions_end_idx    on public.auctions (status, end_time);
create index if not exists auctions_seller_idx on public.auctions (seller_id, created_at desc);

create table if not exists public.auction_bids (
  id           bigint generated always as identity primary key,
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  bidder_id    uuid references auth.users(id) on delete set null,
  bidder_label text not null,
  amount       int  not null,
  is_buy_now   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists auction_bids_idx    on public.auction_bids (auction_id, amount desc);
create index if not exists auction_bids_me_idx on public.auction_bids (bidder_id, created_at desc);

-- ---------- 2. Who can read what ---------------------------------------
-- Auctions are public (except the seller's WhatsApp, shared only with the winner).
-- Nobody writes to the tables directly — only through the functions below.
alter table public.auctions     enable row level security;
alter table public.auction_bids enable row level security;
revoke all on public.auctions, public.auction_bids from anon, authenticated;

grant select (id, seller_id, seller_name, title, description, photo_path, start_price, min_increment,
              buy_now_price, end_time, status, current_bid, current_bidder, current_bidder_label,
              bid_count, extensions, closed_at, created_at)
  on public.auctions to anon, authenticated;
drop policy if exists "Anyone sees auctions" on public.auctions;
create policy "Anyone sees auctions" on public.auctions
  for select using (status <> 'removed' or public.is_admin());

-- Bids are read through auction_bids_for() (with bidder names); own bids readable for "My bids"
grant select (auction_id, amount, created_at) on public.auction_bids to authenticated;
drop policy if exists "Bidder sees own bids" on public.auction_bids;
create policy "Bidder sees own bids" on public.auction_bids
  for select to authenticated using (bidder_id = auth.uid());

-- ---------- 3. Helpers --------------------------------------------------
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- "Maitreya Hinde" → "Maitreya H." ; falls back to the email name
create or replace function public._display_name(p_uid uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    nullif(trim(regexp_replace(
      split_part(trim(coalesce(p.full_name, '')), ' ', 1) || ' ' ||
      coalesce(left(nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 2), ''), 1) || '.', ''),
      '\s+', ' ', 'g')), ''),
    split_part(u.email, '@', 1), 'Collector')
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = p_uid;
$$;
revoke execute on function public._display_name(uuid) from public, anon, authenticated;

-- Bidder name shown publicly: Google name, or the email name if Google gave none
create or replace function public._bidder_name(p_uid uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(trim(regexp_replace(coalesce(p.full_name, u.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g')), ''),
                  split_part(u.email, '@', 1), 'Collector')
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_uid;
$$;
revoke execute on function public._bidder_name(uuid) from public, anon, authenticated;

-- (old masking helper, no longer used)
create or replace function public._mask(p text)
returns text language sql immutable as $$
  select case when length(coalesce(p, '')) <= 2 then coalesce(left(p, 1), '?') || '•••'
              else left(p, 1) || '•••' || right(split_part(p, ' ', 1), 1) end;
$$;

-- ---------- 4. Start an auction -----------------------------------------
create or replace function public.create_auction(
  p_title text, p_description text, p_photo_path text,
  p_start_price int, p_min_increment int, p_buy_now_price int,
  p_end_time timestamptz, p_whatsapp text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_wa  text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Please sign in with Google to start an auction'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Please enter a title (at least 3 letters)'; end if;
  if length(trim(p_title)) > 80 then raise exception 'Title is too long (max 80 characters)'; end if;
  if length(coalesce(p_description, '')) > 600 then raise exception 'Description is too long (max 600 characters)'; end if;
  if coalesce(p_photo_path, '') = '' or split_part(p_photo_path, '/', 1) <> v_uid::text then
    raise exception 'Please add a photo of the car';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'auction-photos' and name = p_photo_path) then
    raise exception 'Photo upload did not finish — please add the photo again';
  end if;
  if p_start_price is null or p_start_price < 1 then raise exception 'Starting bid must be at least ₹1'; end if;
  if p_start_price > 1000000 then raise exception 'Starting bid is too high'; end if;
  if p_min_increment is null or p_min_increment < 1 then raise exception 'Minimum increment must be at least ₹1'; end if;
  if p_min_increment > 100000 then raise exception 'Minimum increment is too high'; end if;
  if p_buy_now_price is not null and p_buy_now_price < p_start_price + p_min_increment then
    raise exception 'Buy Now price must be at least ₹% (starting bid + increment)', p_start_price + p_min_increment;
  end if;
  if p_buy_now_price is not null and p_buy_now_price > 1000000 then raise exception 'Buy Now price is too high'; end if;
  if p_end_time is null or p_end_time < now() + interval '15 minutes' then
    raise exception 'End time must be at least 15 minutes from now';
  end if;
  if p_end_time > now() + interval '30 days' then raise exception 'End time can be at most 30 days from now'; end if;
  if length(v_wa) = 12 and v_wa like '91%' then v_wa := substr(v_wa, 3); end if;
  if v_wa !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  if (select count(*) from public.auctions where seller_id = v_uid and status = 'live' and end_time > now()) >= 10 then
    raise exception 'You can have at most 10 live auctions at a time';
  end if;

  insert into public.auctions (seller_id, seller_name, seller_whatsapp, title, description, photo_path,
                               start_price, min_increment, buy_now_price, end_time)
  values (v_uid, public._display_name(v_uid), v_wa, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
          p_photo_path, p_start_price, p_min_increment, p_buy_now_price, date_trunc('minute', p_end_time))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_auction(text, text, text, int, int, int, timestamptz, text) from anon;
grant execute on function public.create_auction(text, text, text, int, int, int, timestamptz, text) to authenticated;

-- ---------- 5. Place a bid ---------------------------------------------
create or replace function public.place_bid(p_auction uuid, p_amount int)
returns table (out_current_bid int, out_bid_count int, out_next_min int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a     public.auctions%rowtype;
  v_min int;
  v_inc int;
  v_late boolean;
  v_label text;
begin
  if v_uid is null then raise exception 'Please sign in with Google to bid'; end if;
  select * into a from public.auctions where id = p_auction for update;     -- one bid at a time
  if not found or a.status = 'removed' then raise exception 'Auction not found'; end if;
  if a.status = 'sold' then raise exception 'Sorry, this car was just bought with Buy Now'; end if;
  if a.status <> 'live' then raise exception 'This auction was cancelled'; end if;
  if now() >= a.end_time then raise exception 'Bidding has closed for this auction'; end if;
  if a.seller_id = v_uid then raise exception 'You can''t bid on your own auction'; end if;
  if a.current_bidder = v_uid then raise exception 'You are already the highest bidder'; end if;

  -- final 2 minutes: bigger steps (at least ₹100) and each bid resets the clock to 2 minutes
  v_late := a.end_time - now() <= interval '2 minutes';
  v_inc  := case when v_late then greatest(a.min_increment, 100) else a.min_increment end;
  v_min  := coalesce(a.current_bid + v_inc, a.start_price);
  if p_amount is null or p_amount < v_min then
    if v_late and a.current_bid is not null then
      raise exception 'Final 2 minutes: bids must be ₹% higher — the minimum bid now is ₹%', v_inc, v_min;
    end if;
    raise exception 'Bid too low — the minimum bid now is ₹%', v_min;
  end if;
  if a.buy_now_price is not null and p_amount >= a.buy_now_price then
    raise exception 'That''s at or above the Buy Now price — tap Buy Now for ₹% instead', a.buy_now_price;
  end if;
  if p_amount > v_min + greatest(v_inc * 100, 50000) then
    raise exception 'That bid is unusually high — please check the amount';
  end if;

  v_label := public._bidder_name(v_uid);
  insert into public.auction_bids (auction_id, bidder_id, bidder_label, amount)
  values (a.id, v_uid, v_label, p_amount);
  update public.auctions
     set current_bid = p_amount, current_bidder = v_uid, current_bidder_label = v_label, bid_count = bid_count + 1,
         end_time   = case when v_late then now() + interval '2 minutes' else end_time end,
         extensions = extensions + case when v_late then 1 else 0 end
   where id = a.id;
  return query select p_amount, a.bid_count + 1, p_amount + v_inc;
end $$;
revoke execute on function public.place_bid(uuid, int) from anon;
grant execute on function public.place_bid(uuid, int) to authenticated;

-- ---------- 6. Buy Now (ends the auction at once) -----------------------
create or replace function public.buy_now(p_auction uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.auctions%rowtype; v_label text;
begin
  if v_uid is null then raise exception 'Please sign in with Google to buy'; end if;
  select * into a from public.auctions where id = p_auction for update;
  if not found or a.status = 'removed' then raise exception 'Auction not found'; end if;
  if a.status = 'sold' then raise exception 'Sorry, someone just bought this with Buy Now'; end if;
  if a.status <> 'live' then raise exception 'This auction was cancelled'; end if;
  if now() >= a.end_time then raise exception 'Bidding has closed for this auction'; end if;
  if a.buy_now_price is null then raise exception 'This auction has no Buy Now price'; end if;
  if a.seller_id = v_uid then raise exception 'You can''t buy your own car'; end if;

  v_label := public._bidder_name(v_uid);
  insert into public.auction_bids (auction_id, bidder_id, bidder_label, amount, is_buy_now)
  values (a.id, v_uid, v_label, a.buy_now_price, true);
  update public.auctions
     set status = 'sold', current_bid = a.buy_now_price, current_bidder = v_uid, current_bidder_label = v_label,
         bid_count = bid_count + 1, closed_at = now()
   where id = a.id;
end $$;
revoke execute on function public.buy_now(uuid) from anon;
grant execute on function public.buy_now(uuid) to authenticated;

-- ---------- 7. Cancel (seller, only before the first bid) / remove (admin) ---
create or replace function public.cancel_auction(p_auction uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions%rowtype;
begin
  select * into a from public.auctions where id = p_auction for update;
  if not found then raise exception 'Auction not found'; end if;
  if public.is_admin() then
    update public.auctions set status = 'removed', closed_at = now() where id = a.id;
    return;
  end if;
  if a.seller_id is distinct from auth.uid() then raise exception 'Only the seller can cancel this auction'; end if;
  if a.status <> 'live' or now() >= a.end_time then raise exception 'This auction has already ended'; end if;
  if a.bid_count > 0 then raise exception 'Auctions with bids can''t be cancelled'; end if;
  update public.auctions set status = 'cancelled', closed_at = now() where id = a.id;
end $$;
revoke execute on function public.cancel_auction(uuid) from anon;
grant execute on function public.cancel_auction(uuid) to authenticated;

-- ---------- 8. Bid history (with bidder names) ---------------------------
create or replace function public.auction_bids_for(p_auction uuid)
returns table (amount int, bidder text, is_me boolean, is_buy_now boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.amount, b.bidder_label, b.bidder_id is not distinct from auth.uid() and auth.uid() is not null,
         b.is_buy_now, b.created_at
    from public.auction_bids b join public.auctions a on a.id = b.auction_id
   where b.auction_id = p_auction and (a.status <> 'removed' or public.is_admin())
   order by b.amount desc, b.created_at
   limit 100;
$$;
grant execute on function public.auction_bids_for(uuid) to anon, authenticated;

-- ---------- 9. Contact details — only seller & winner, only after it ends ---
create or replace function public.auction_contact(p_auction uuid)
returns table (seller_name text, seller_whatsapp text, seller_email text,
               winner_name text, winner_email text, winner_phone text, winning_bid int)
language plpgsql stable security definer set search_path = public, auth as $$
declare a public.auctions%rowtype;
begin
  select * into a from public.auctions where id = p_auction;
  if not found or auth.uid() is null then return; end if;
  if not (a.status = 'sold' or (a.status = 'live' and now() >= a.end_time)) or a.current_bidder is null then return; end if;
  if auth.uid() not in (a.seller_id, a.current_bidder) and not public.is_admin() then return; end if;
  return query
    select a.seller_name, a.seller_whatsapp, su.email::text,
           coalesce(nullif(wp.full_name, ''), split_part(wu.email, '@', 1)), wu.email::text, wp.phone, a.current_bid
      from auth.users su, auth.users wu left join public.profiles wp on wp.user_id = wu.id
     where su.id = a.seller_id and wu.id = a.current_bidder;
end $$;
revoke execute on function public.auction_contact(uuid) from anon;
grant execute on function public.auction_contact(uuid) to authenticated;

-- ---------- 10. Photo storage (1 photo per auction, public) --------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('auction-photos', 'auction-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public reads auction photos" on storage.objects;
create policy "Public reads auction photos" on storage.objects
  for select using (bucket_id = 'auction-photos');
drop policy if exists "Users upload own auction photos" on storage.objects;
create policy "Users upload own auction photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'auction-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own unused auction photos" on storage.objects;
create policy "Users delete own unused auction photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'auction-photos' and owner = auth.uid()
         and not exists (select 1 from public.auctions a where a.photo_path = storage.objects.name));

-- Show real names on bids placed before this update
update public.auction_bids set bidder_label = public._bidder_name(bidder_id) where bidder_id is not null;
update public.auctions set current_bidder_label = public._bidder_name(current_bidder) where current_bidder is not null;

-- Check
select 'Auctions installed' as result, (select count(*) from public.auctions) as auctions;
