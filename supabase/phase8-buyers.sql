-- =====================================================================
--  MHC Diecast — buyer accounts (Sign in with Google)
--  Run ONCE in Supabase → SQL Editor, after phase7-sellers.sql.
--  Safe to run again.
-- =====================================================================

-- ---------- 1. PROFILES (one per buyer) --------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  phone      text check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
drop policy if exists "Buyer manages own profile" on public.profiles;
create policy "Buyer manages own profile" on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fill the profile automatically from Google on first sign-in
create or replace function public.handle_new_buyer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, email, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.email,
          coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.handle_new_buyer();

-- ---------- 2. SAVED ADDRESSES ------------------------------------------
create table if not exists public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  phone      text not null check (phone ~ '^[6-9][0-9]{9}$'),
  address    text not null,
  city       text,
  state      text,
  pincode    text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id, created_at desc);
alter table public.addresses enable row level security;
revoke all on public.addresses from anon;
drop policy if exists "Buyer manages own addresses" on public.addresses;
create policy "Buyer manages own addresses" on public.addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 3. SAVED CART (same cart on every device) --------------------
create table if not exists public.cart_items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty        int  not null check (qty between 1 and 20),
  added_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.cart_items enable row level security;
revoke all on public.cart_items from anon;
drop policy if exists "Buyer manages own cart" on public.cart_items;
create policy "Buyer manages own cart" on public.cart_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Replace the whole cart in one step (the website sends the full list)
create or replace function public.save_cart(p_items jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.cart_items c
   where c.user_id = auth.uid()
     and c.product_id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x);
  insert into public.cart_items (user_id, product_id, qty)
  select auth.uid(), (x->>'id')::uuid, least(greatest((x->>'qty')::int, 1), 20)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where exists (select 1 from public.products p where p.id = (x->>'id')::uuid)
  on conflict (user_id, product_id) do update set qty = excluded.qty;
end $$;
revoke execute on function public.save_cart(jsonb) from anon;
grant execute on function public.save_cart(jsonb) to authenticated;

-- ---------- 4. ORDERS belong to the buyer ------------------------------
alter table public.orders add column if not exists buyer_id uuid references auth.users(id) on delete set null;
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
drop policy if exists "Buyer reads own orders" on public.orders;
create policy "Buyer reads own orders" on public.orders
  for select to authenticated using (buyer_id = auth.uid());

-- Orders now require a signed-in buyer (same arguments as before)
create or replace function public.place_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_screenshot_path text,
  p_utr             text default null,
  p_seller_id       uuid default null
)
returns table (out_code text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      int;
  v_subtotal numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_pincode  text := trim(coalesce(p_customer->>'pincode',''));
  v_phone    text := regexp_replace(coalesce(p_customer->>'phone',''), '\D', '', 'g');
  v_seller   uuid := p_seller_id;
  v_ship_out numeric;
  v_is_goa   boolean;
  v_shipping numeric;
  v_total    numeric;
  v_code     text;
  v_buyer    uuid := auth.uid();
begin
  if v_buyer is null then raise exception 'Please sign in with Google to place your order'; end if;
  if exists (select 1 from public.sellers s where s.user_id = v_buyer) or public.is_admin() then
    raise exception 'Seller and admin accounts cannot place orders. Sign in with a buyer Google account.';
  end if;
  if length(v_phone) = 12 and v_phone like '91%' then v_phone := substr(v_phone, 3); end if;
  if coalesce(trim(p_customer->>'name'),'') = '' then raise exception 'Please enter your name'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit mobile number'; end if;
  if coalesce(trim(p_customer->>'address'),'') = '' then raise exception 'Please enter your address'; end if;
  if v_pincode !~ '^[1-9][0-9]{5}$' then raise exception 'Please enter a valid 6-digit pincode'; end if;
  if coalesce(p_screenshot_path,'') = '' then raise exception 'Payment screenshot is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'Invalid quantity in cart'; end if;

    select * into v_prod from public.products
      where id = (v_item->>'id')::uuid and is_active
      for update;
    if not found then raise exception 'A car in your cart is no longer available'; end if;
    if v_seller is null then v_seller := v_prod.seller_id; end if;
    if v_prod.seller_id is distinct from v_seller then
      raise exception 'Cars from different sellers must be paid separately';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % left of %', v_prod.stock, v_prod.name;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'qty', v_qty, 'image', v_prod.images[1]);
  end loop;

  select outside_goa_shipping into v_ship_out from public.sellers where id = v_seller and is_active;
  if v_seller is not null and v_ship_out is null then raise exception 'This seller is not taking orders right now'; end if;
  if v_ship_out is null then select outside_goa_shipping into v_ship_out from public.settings where id = 1; end if;

  v_is_goa   := v_pincode like '403%';
  v_shipping := case when v_is_goa then 0 else coalesce(v_ship_out, 0) end;
  v_total    := v_subtotal + v_shipping;
  v_code     := 'MHC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (order_code, seller_id, buyer_id, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path)
  values (v_code, v_seller, v_buyer, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, v_shipping, v_total, nullif(trim(p_utr),''), p_screenshot_path);

  return query select v_code, v_total;
end $$;
grant execute on function public.place_order(jsonb, jsonb, text, text, uuid) to anon, authenticated;

-- ---------- 5. DELETE MY ACCOUNT ---------------------------------------
-- Keeps past orders for the seller's records, unlinked from the account.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if public.is_admin() or exists (select 1 from public.sellers where user_id = v_uid) then
    raise exception 'Admin and seller accounts cannot be deleted here';
  end if;
  update public.orders set buyer_id = null where buyer_id = v_uid;
  delete from auth.users where id = v_uid;   -- profile, addresses and cart go with it
end $$;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
