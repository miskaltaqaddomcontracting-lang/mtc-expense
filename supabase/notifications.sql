-- =====================================================================
-- MTC খরচ হিসাব — প্রতিদিন রাতের নোটিফিকেশন (রিমাইন্ডার)
-- Supabase → SQL Editor → New query → এই পুরো ফাইল পেস্ট করে Run। একাধিকবার চালালেও সমস্যা নেই।
-- =====================================================================

-- কোন ফোন/ব্রাউজারে নোটিফিকেশন যাবে
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active_user());

-- সবাই পড়তে পারে এমন সেটিং (নোটিফিকেশনের public key)
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (true);

-- গোপন সেটিং — কোনো ইউজার পড়তে পারে না (শুধু GitHub-এর রাতের কাজ secret key দিয়ে পড়ে)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

notify pgrst, 'reload schema';
