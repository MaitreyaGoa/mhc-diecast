-- Run phase6-categories.sql first.
-- =====================================================================
--  Sample cars for testing (Phase 1 / Phase 2).
--  Run in Supabase → SQL Editor. They show with placeholder pictures.
--  To remove them later, run the DELETE at the bottom.
-- =====================================================================
insert into public.products (name, brand, series, scale, mrp, price, stock, description, category) values
  ('''67 Camaro',                 'Hot Wheels', 'HW Dream Garage', '1:64', 249, 199, 3, 'SAMPLE – delete before launch', 'Mainline'),
  ('Nissan Skyline GT-R (R34)',   'Hot Wheels', 'Car Culture',     '1:64', 599, 549, 1, 'SAMPLE – delete before launch', 'Premium'),
  ('Porsche 911 GT3 RS',          'Mini GT',    null,              '1:64', 999, 899, 2, 'SAMPLE – delete before launch', 'Premium'),
  ('Bone Shaker',                 'Hot Wheels', 'HW Legends',      '1:64', 199, 179, 0, 'SAMPLE – delete before launch', 'Mainline'),
  ('Land Rover Defender 110',     'Matchbox',   'Off-Road',        '1:64', 229, 199, 5, 'SAMPLE – delete before launch', 'Mainline'),
  ('Twin Mill',                   'Hot Wheels', 'HW Originals',    '1:64', 199, 179, 4, 'SAMPLE – delete before launch', 'Mainline');

-- Remove all sample cars (run this before going live):
-- delete from public.products where description = 'SAMPLE – delete before launch';
