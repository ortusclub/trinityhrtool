-- Add South Korea to the holiday_country enum so holidays and users can be
-- tagged 'KR'. Same shape as 20260630_add_us_holiday_country.sql.
--
-- ADD VALUE IF NOT EXISTS is idempotent. Note: a newly added enum value can't
-- be used in the SAME transaction it's created in — run this on its own (the
-- Supabase SQL editor does), then 'KR' is usable immediately.
ALTER TYPE public.holiday_country ADD VALUE IF NOT EXISTS 'KR';
