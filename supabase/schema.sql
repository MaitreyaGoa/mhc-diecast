-- =====================================================================
--  MHC Diecast — Supabase database setup (Phase 1)
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run once on a fresh project.
-- =====================================================================

-- ---------- 1. ADMINS (who can log in to the seller panel) -----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies = nobody can read/write it from the website

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- 2. PRODUCTS (the cars you sell) --------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                    -- e.g. "'67 Camaro"
  brand       text not null default 'Hot Wheels',
  series      text,                             -- e.g. "HW Dream Garage", "Car Culture"
  scale       text not null default '1:64',
  mrp         numeric(10,2) not null check (mrp >= 0),
  price       numeric(10,2) not null check (price >= 0),   -- your selling price
  stock       integer not null default 1 check (stock >= 0),
  images      text[] not null default '{}',     -- public image URLs, first = cover
  description text,
  is_active   boolean not null default true,    -- untick to hide without deleting
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists products_active_idx on public.products (is_active, created_at desc);
alter table public.products enable row level security;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products
  for select using (is_active or public.is_admin());

drop policy if exists "Admin manages products" on public.products;
create policy "Admin manages products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. SETTINGS (single row: QR, UPI, shipping) --------------
create table if not exists public.settings (
  id                   int primary key default 1 check (id = 1),
  store_name           text not null default 'MHC Diecast',
  upi_id               text,
  payee_name           text,
  qr_image_url         text,
  outside_goa_shipping numeric(10,2) not null default 100,
  whatsapp_number      text,                    -- with country code, e.g. 919999999999
  updated_at           timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;
alter table public.settings enable row level security;

drop policy if exists "Anyone can read settings" on public.settings;
create policy "Anyone can read settings" on public.settings for select using (true);

drop policy if exists "Admin updates settings" on public.settings;
create policy "Admin updates settings" on public.settings
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- 4. ORDERS -------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_code      text not null unique,          -- shown to buyer, e.g. MHC-7F3A2C
  customer_name   text not null,
  phone           text not null,
  email           text,
  address         text not null,
  city            text,
  state           text,
  pincode         text not null,
  is_goa          boolean not null,
  items           jsonb not null,                -- snapshot: [{id,name,price,qty,image}]
  subtotal        numeric(10,2) not null,
  shipping        numeric(10,2) not null,
  total           numeric(10,2) not null,
  utr             text,                          -- optional UPI reference no.
  screenshot_path text not null,                 -- file in 'payment-screenshots' bucket
  status          text not null default 'pending'
                  check (status in ('pending','confirmed','shipped','delivered','rejected','cancelled')),
  tracking_number text,
  admin_note      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
alter table public.orders enable row level security;
-- Buyers never read/write this table directly — only through the functions below.
drop policy if exists "Admin manages orders" on public.orders;
create policy "Admin manages orders" on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 5. PLACE ORDER (called from checkout) ---------------------
-- Prices and shipping are recalculated here from the database, so nobody
-- can change the amount in their browser. Stock is reserved immediately.
create or replace function public.place_order(
  p_customer        jsonb,     -- {name, phone, email, address, city, state, pincode}
  p_items           jsonb,     -- [{id, qty}]
  p_screenshot_path text,
  p_utr             text default null
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
  v_is_goa   boolean;
  v_shipping numeric;
  v_total    numeric;
  v_code     text;
begin
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
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % left of %', v_prod.stock, v_prod.name;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'qty', v_qty, 'image', v_prod.images[1]);
  end loop;

  v_is_goa := v_pincode like '403%';               -- all Goa pincodes start with 403
  select case when v_is_goa then 0 else outside_goa_shipping end
    into v_shipping from public.settings where id = 1;
  v_total := v_subtotal + coalesce(v_shipping, 0);
  v_code  := 'MHC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (order_code, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path)
  values (v_code, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, coalesce(v_shipping,0), v_total, nullif(trim(p_utr),''), p_screenshot_path);

  return query select v_code, v_total;
end $$;

-- ---------- 6. ORDER STATUS LOOKUP (buyer enters code + phone) --------
create or replace function public.get_order_status(p_code text, p_phone text)
returns table (order_code text, status text, items jsonb, subtotal numeric, shipping numeric,
               total numeric, tracking_number text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.order_code, o.status, o.items, o.subtotal, o.shipping, o.total, o.tracking_number, o.created_at
  from public.orders o
  where upper(o.order_code) = upper(trim(p_code))
    and o.phone = right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
$$;

grant execute on function public.place_order(jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.get_order_status(text, text) to anon, authenticated;

-- ---------- 7. AUTO STOCK RETURN when you reject/cancel an order ------
create or replace function public.orders_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_line jsonb;
begin
  if new.status in ('rejected','cancelled') and old.status not in ('rejected','cancelled') then
    for v_line in select * from jsonb_array_elements(new.items) loop
      update public.products set stock = stock + (v_line->>'qty')::int, updated_at = now()
       where id = (v_line->>'id')::uuid;
    end loop;
  elsif old.status in ('rejected','cancelled') and new.status not in ('rejected','cancelled') then
    for v_line in select * from jsonb_array_elements(new.items) loop
      update public.products set stock = greatest(stock - (v_line->>'qty')::int, 0), updated_at = now()
       where id = (v_line->>'id')::uuid;
    end loop;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_status_change on public.orders;
create trigger orders_status_change before update on public.orders
  for each row execute function public.orders_status_change();

-- ---------- 8. FILE STORAGE -------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images',      'product-images',      true,  5242880, array['image/jpeg','image/png','image/webp']),
  ('payment-screenshots', 'payment-screenshots', false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('site-assets',         'site-assets',         true,  5242880, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists "Public reads product images and site assets" on storage.objects;
create policy "Public reads product images and site assets" on storage.objects
  for select using (bucket_id in ('product-images','site-assets'));

drop policy if exists "Admin uploads product images and site assets" on storage.objects;
create policy "Admin uploads product images and site assets" on storage.objects
  for insert with check (bucket_id in ('product-images','site-assets') and public.is_admin());

drop policy if exists "Admin edits product images and site assets" on storage.objects;
create policy "Admin edits product images and site assets" on storage.objects
  for update using (bucket_id in ('product-images','site-assets') and public.is_admin());

drop policy if exists "Admin deletes files" on storage.objects;
create policy "Admin deletes files" on storage.objects
  for delete using (bucket_id in ('product-images','site-assets','payment-screenshots') and public.is_admin());

drop policy if exists "Buyers upload payment screenshots" on storage.objects;
create policy "Buyers upload payment screenshots" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'payment-screenshots');

drop policy if exists "Only admin views payment screenshots" on storage.objects;
create policy "Only admin views payment screenshots" on storage.objects
  for select using (bucket_id = 'payment-screenshots' and public.is_admin());

-- =====================================================================
--  LAST STEP (run separately, after creating your login user):
--  insert into public.admins (user_id) values ('PASTE-YOUR-USER-UID-HERE');
-- =====================================================================
