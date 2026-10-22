-- =====================================================================
--  MHC Diecast — multi-seller update (1 master admin + sellers)
--  Run ONCE in Supabase → SQL Editor, after phase6-categories.sql.
--  Safe to run again.
-- =====================================================================

-- ---------- 1. SELLERS ------------------------------------------------
create table if not exists public.sellers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users(id) on delete set null,  -- their login
  login_email          text,
  shop_name            text not null,
  whatsapp             text not null,                -- 10-digit or 91XXXXXXXXXX
  upi_id               text,
  payee_name           text,
  qr_image_url         text,
  outside_goa_shipping numeric(10,2) not null default 100 check (outside_goa_shipping >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.sellers enable row level security;

-- The seller row of whoever is logged in (null for buyers / master without a shop)
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sellers where user_id = auth.uid() and is_active limit 1;
$$;

-- Who am I? Used by the admin page after login.
create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', case when public.is_admin() then 'admin'
                 when exists (select 1 from public.sellers where user_id = auth.uid() and is_active) then 'seller'
                 else null end,
    'seller', (select to_jsonb(s) from public.sellers s where s.user_id = auth.uid() limit 1));
$$;

-- Buyers may read only the public columns (never user_id / login email)
revoke all on public.sellers from anon;
revoke all on public.sellers from authenticated;
grant select (id, shop_name, whatsapp, upi_id, payee_name, qr_image_url, outside_goa_shipping, is_active)
  on public.sellers to anon, authenticated;
grant insert, update, delete on public.sellers to authenticated;

-- Full seller list (incl. login email) for the master only
create or replace function public.admin_list_sellers()
returns setof public.sellers language sql stable security definer set search_path = public as $$
  select * from public.sellers where public.is_admin() order by created_at;
$$;
grant execute on function public.admin_list_sellers() to authenticated;

drop policy if exists "Read active sellers" on public.sellers;
create policy "Read active sellers" on public.sellers
  for select using (is_active or public.is_admin() or user_id = auth.uid());

drop policy if exists "Master adds sellers" on public.sellers;
create policy "Master adds sellers" on public.sellers
  for insert with check (public.is_admin());

drop policy if exists "Master deletes sellers" on public.sellers;
create policy "Master deletes sellers" on public.sellers
  for delete using (public.is_admin());

drop policy if exists "Seller edits own shop, master edits all" on public.sellers;
create policy "Seller edits own shop, master edits all" on public.sellers
  for update using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

-- Sellers can't change their login link or switch themselves on/off
create or replace function public.sellers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.is_active is distinct from old.is_active
       or new.login_email is distinct from old.login_email then
      raise exception 'Only the master admin can change login or active status';
    end if;
  end if;
  new.whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');
  if length(new.whatsapp) = 12 and new.whatsapp like '91%' then new.whatsapp := substr(new.whatsapp, 3); end if;
  if new.whatsapp !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sellers_guard on public.sellers;
create trigger sellers_guard before insert or update on public.sellers
  for each row execute function public.sellers_guard();

-- Master links a seller to a login created in Authentication → Users
create or replace function public.admin_link_seller(p_seller uuid, p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'No login found for %. Create it first in Supabase → Authentication → Users.', p_email;
  end if;
  if exists (select 1 from public.sellers where user_id = v_uid and id <> p_seller) then
    raise exception 'That login is already linked to another seller';
  end if;
  update public.sellers set user_id = v_uid, login_email = lower(trim(p_email)) where id = p_seller;
  return 'linked';
end $$;

grant execute on function public.my_seller_id() to anon, authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.admin_link_seller(uuid, text) to authenticated;

-- Master's own shop: created from the current Settings (UPI, WhatsApp, shipping)
insert into public.sellers (user_id, login_email, shop_name, whatsapp, upi_id, payee_name, qr_image_url, outside_goa_shipping)
select a.user_id, u.email, coalesce(s.store_name, 'MHC Diecast'),
       coalesce(nullif(s.whatsapp_number, ''), '7358425108'), s.upi_id, s.payee_name, s.qr_image_url,
       coalesce(s.outside_goa_shipping, 100)
from public.admins a
join auth.users u on u.id = a.user_id
cross join public.settings s
where s.id = 1
  and not exists (select 1 from public.sellers x where x.user_id = a.user_id)
limit 1;

-- ---------- 2. PRODUCTS belong to a seller -----------------------------
alter table public.products add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists products_seller_idx on public.products (seller_id);
update public.products set seller_id = (select s.id from public.sellers s join public.admins a on a.user_id = s.user_id limit 1)
 where seller_id is null;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products
  for select using (
    (is_active and (seller_id is null or exists (select 1 from public.sellers s where s.id = seller_id and s.is_active)))
    or public.is_admin() or seller_id = public.my_seller_id());

drop policy if exists "Admin manages products" on public.products;
drop policy if exists "Master or owner adds products" on public.products;
create policy "Master or owner adds products" on public.products
  for insert with check (public.is_admin() or (seller_id is not null and seller_id = public.my_seller_id()));
drop policy if exists "Master or owner edits products" on public.products;
create policy "Master or owner edits products" on public.products
  for update using (public.is_admin() or seller_id = public.my_seller_id())
  with check (public.is_admin() or seller_id = public.my_seller_id());
drop policy if exists "Master or owner deletes products" on public.products;
create policy "Master or owner deletes products" on public.products
  for delete using (public.is_admin() or seller_id = public.my_seller_id());

-- ---------- 3. ORDERS belong to a seller -------------------------------
alter table public.orders add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists orders_seller_idx on public.orders (seller_id, status, created_at desc);
update public.orders set seller_id = (select s.id from public.sellers s join public.admins a on a.user_id = s.user_id limit 1)
 where seller_id is null;

drop policy if exists "Seller reads own orders" on public.orders;
create policy "Seller reads own orders" on public.orders
  for select using (seller_id = public.my_seller_id());
drop policy if exists "Seller updates own orders" on public.orders;
create policy "Seller updates own orders" on public.orders
  for update using (seller_id = public.my_seller_id()) with check (seller_id = public.my_seller_id());

-- ---------- 4. PLACE ORDER: one order per seller -----------------------
-- (old 4-argument version replaced; the shop calls this once per seller in the cart)
drop function if exists public.place_order(jsonb, jsonb, text, text);
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

  insert into public.orders (order_code, seller_id, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path)
  values (v_code, v_seller, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, v_shipping, v_total, nullif(trim(p_utr),''), p_screenshot_path);

  return query select v_code, v_total;
end $$;
grant execute on function public.place_order(jsonb, jsonb, text, text, uuid) to anon, authenticated;

-- ---------- 5. ORDER STATUS now includes the seller ---------------------
drop function if exists public.get_order_status(text, text);
create or replace function public.get_order_status(p_code text, p_phone text)
returns table (order_code text, status text, items jsonb, subtotal numeric, shipping numeric,
               total numeric, tracking_number text, created_at timestamptz,
               seller_name text, seller_whatsapp text)
language sql stable security definer set search_path = public as $$
  select o.order_code, o.status, o.items, o.subtotal, o.shipping, o.total, o.tracking_number, o.created_at,
         s.shop_name, s.whatsapp
  from public.orders o
  left join public.sellers s on s.id = o.seller_id
  where upper(o.order_code) = upper(trim(p_code))
    and o.phone = right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
$$;
grant execute on function public.get_order_status(text, text) to anon, authenticated;

-- ---------- 6. FILES: sellers upload photos & QR; see own screenshots ----
drop policy if exists "Admin uploads product images and site assets" on storage.objects;
create policy "Admin uploads product images and site assets" on storage.objects
  for insert with check (bucket_id in ('product-images','site-assets')
                         and (public.is_admin() or public.my_seller_id() is not null));

drop policy if exists "Admin edits product images and site assets" on storage.objects;
create policy "Admin edits product images and site assets" on storage.objects
  for update using (bucket_id in ('product-images','site-assets') and (public.is_admin() or owner = auth.uid()));

drop policy if exists "Admin deletes files" on storage.objects;
create policy "Admin deletes files" on storage.objects
  for delete using ((bucket_id in ('product-images','site-assets','payment-screenshots') and public.is_admin())
                    or (bucket_id in ('product-images','site-assets') and owner = auth.uid()));

drop policy if exists "Only admin views payment screenshots" on storage.objects;
create policy "Only admin views payment screenshots" on storage.objects
  for select using (bucket_id = 'payment-screenshots' and (
    public.is_admin()
    or exists (select 1 from public.orders o where o.screenshot_path = storage.objects.name
                                              and o.seller_id = public.my_seller_id())));

-- =====================================================================
--  ADDING A SELLER (repeat for each, up to 5):
--  1. Authentication → Users → Add user → their email + password → Auto Confirm.
--  2. Admin panel → Sellers → Add seller → shop name, WhatsApp, their email.
-- =====================================================================
