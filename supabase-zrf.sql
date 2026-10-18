-- ZRF.AI — รันใน Supabase → SQL Editor ครั้งเดียว

-- ประวัติการแปลทุกครั้ง (ข้อมูลสำหรับฝึกโมเดล)
create table if not exists public.zrf_history (
  id bigserial primary key,
  created_at timestamptz default now(),
  dir text not null,
  src text not null,
  out text not null,
  picks jsonb default '[]'::jsonb,
  verified boolean default false
);
alter table public.zrf_history enable row level security;
drop policy if exists "zh_insert" on public.zrf_history;
drop policy if exists "zh_admin" on public.zrf_history;
create policy "zh_insert" on public.zrf_history for insert to anon, authenticated
  with check (char_length(src) <= 300 and char_length(out) <= 600);
create policy "zh_admin" on public.zrf_history for all to authenticated using (true) with check (true);

-- ตัวโมเดล ZRF.AI (แถวเดียว id = 1)
create table if not exists public.zrf_model (
  id int primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.zrf_model enable row level security;
drop policy if exists "zm_read" on public.zrf_model;
drop policy if exists "zm_write" on public.zrf_model;
create policy "zm_read"  on public.zrf_model for select using (true);
create policy "zm_write" on public.zrf_model for all to authenticated using (true) with check (true);

-- ลบประวัติที่ยังไม่ยืนยันเมื่อครบ 90 วัน (ตามนโยบายข้อมูล) — ต้องเปิด Extensions → pg_cron ก่อน
create extension if not exists pg_cron;
select cron.schedule('zrf-clean-history', '0 3 * * *',
  $$ delete from public.zrf_history where verified = false and created_at < now() - interval '90 days' $$);
