-- =====================================================================
--  MHC Diecast — categories update
--  Run once in Supabase → SQL Editor. Safe to run more than once.
-- =====================================================================

-- Category of each car (used by the shop menu and filters)
alter table public.products
  add column if not exists category text;

alter table public.products drop constraint if exists products_category_check;
alter table public.products
  add constraint products_category_check
  check (category is null or category in ('Mainline', 'Premium', 'Chase', 'Pre-owned', 'Accessory'));

create index if not exists products_category_idx on public.products (category);

-- Existing cars: treat them as Mainline until you change them in admin
update public.products set category = 'Mainline' where category is null;
