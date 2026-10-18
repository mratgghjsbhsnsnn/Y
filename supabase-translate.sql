-- Zaan Translate — รันใน Supabase → SQL Editor ครั้งเดียว
-- (ถ้าไม่รัน ระบบยังแปลได้ แต่จะไม่มีแคชกลางและไม่มีบริบทคำซ้ำ)

-- 1) แคชกลาง: ผลที่ AI เคยแปลแล้ว ทุกคนใช้ร่วมกัน → ไม่เสียเครดิตซ้ำ
create table if not exists public.translate_cache (
  k text primary key,
  d text,
  t text,
  v jsonb not null,
  created_at timestamptz default now()
);
alter table public.translate_cache enable row level security;
drop policy if exists "tc_read" on public.translate_cache;
drop policy if exists "tc_insert" on public.translate_cache;
create policy "tc_read"   on public.translate_cache for select using (true);
create policy "tc_insert" on public.translate_cache for insert with check (char_length(t) <= 300);

-- 2) บริบทของคำซ้ำ: AI วิเคราะห์ครั้งเดียวจากหน้าผู้ดูแล แล้วเก็บไว้ใช้ตอนแปล
create table if not exists public.word_contexts (
  word_id text primary key,
  hint text not null,
  updated_at timestamptz default now()
);
alter table public.word_contexts enable row level security;
drop policy if exists "wc_read" on public.word_contexts;
drop policy if exists "wc_write" on public.word_contexts;
create policy "wc_read"  on public.word_contexts for select using (true);
create policy "wc_write" on public.word_contexts for all to authenticated using (true) with check (true);

-- ล้างแคชกลางเมื่ออยากให้แปลใหม่ทั้งหมด:  delete from public.translate_cache;
