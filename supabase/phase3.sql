-- =====================================================================
--  MHC Diecast — Phase 3 (admin panel) small update
--  Run once in Supabase → SQL Editor. Safe to run more than once.
-- =====================================================================

-- Let the admin page check "am I the admin?" after logging in
grant execute on function public.is_admin() to anon, authenticated;

-- Faster admin order list / search
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_phone_idx   on public.orders (phone);
