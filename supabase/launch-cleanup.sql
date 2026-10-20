-- =====================================================================
--  MHC Diecast — run ONCE just before going live.
--  Removes sample cars and test orders. Real cars you added stay.
-- =====================================================================

-- 1. Sample cars from sample-products.sql
delete from public.products where description = 'SAMPLE – delete before launch';

-- 2. All test orders (only run this BEFORE real customers start ordering!)
delete from public.orders;

-- 3. Test payment screenshots: Supabase → Storage → payment-screenshots →
--    select the folders → Delete. (Storage files can't be removed from SQL.)

-- Check: these should show only your real cars and 0 orders
select name, brand, price, stock from public.products order by created_at desc;
select count(*) as orders from public.orders;
