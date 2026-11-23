-- =====================================================================
-- MTC খরচ হিসাব — Supabase ডাটাবেস
-- Supabase Dashboard → SQL Editor → New query → এই পুরো ফাইল পেস্ট করে Run চাপুন।
-- একাধিকবার চালালেও সমস্যা নেই।
-- =====================================================================

-- ---------- টেবিল ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- খাতের আইকন (ইমোজি)
alter table public.categories add column if not exists icon text;

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id),
  category_id bigint not null references public.categories(id),
  expense_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  description text not null default '' check (length(description) <= 500),
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date);

-- ---------- নতুন ইউজার তৈরি হলে নিজে থেকে profile তৈরি ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- নিরাপত্তার জন্য নতুন ইউজার "নিষ্ক্রিয়" থাকে; এডমিন "সদস্য" পাতা থেকে সক্রিয় করবেন
  insert into public.profiles (id, full_name, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), false)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- আগে থেকে থাকা ইউজারদের জন্যও profile
insert into public.profiles (id, full_name, active)
  select id, split_part(email, '@', 1), false from auth.users on conflict (id) do nothing;

-- ---------- সাহায্যকারী ফাংশন ----------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();

-- সদস্য অন্য কারো নামে খরচ দিতে বা খরচের মালিক বদলাতে পারবে না
create or replace function public.guard_expense_owner() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'খরচের মালিক বদলানো যাবে না';
  end if;
  if new.expense_date > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'ভবিষ্যতের তারিখে খরচ দেওয়া যাবে না';
  end if;
  return new;
end $$;
drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard before insert or update on public.expenses
  for each row execute function public.guard_expense_owner();

-- মাসভিত্তিক মোট (ড্যাশবোর্ডের জন্য)
create or replace function public.monthly_totals(max_months int default 12)
returns table (month text, total numeric, entries bigint)
language sql stable security invoker as $$
  select to_char(expense_date, 'YYYY-MM') as month, sum(amount), count(*)
  from public.expenses group by 1 order by 1 desc limit max_months
$$;

-- ---------- নিরাপত্তা নিয়ম (Row Level Security) ----------
alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.expenses   enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles admin"  on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated using (id = auth.uid() or public.is_active_user());
create policy "profiles admin" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "categories read"  on public.categories;
drop policy if exists "categories admin" on public.categories;
create policy "categories read"  on public.categories for select to authenticated using (public.is_active_user());
create policy "categories admin" on public.categories for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "expenses read"   on public.expenses;
drop policy if exists "expenses insert" on public.expenses;
drop policy if exists "expenses update" on public.expenses;
drop policy if exists "expenses delete" on public.expenses;
-- সব সক্রিয় সদস্য সবার খরচ দেখতে পারবে
create policy "expenses read"   on public.expenses for select to authenticated using (public.is_active_user());
-- শুধু নিজের নামে খরচ যোগ
create policy "expenses insert" on public.expenses for insert to authenticated with check (public.is_active_user() and user_id = auth.uid());
-- নিজের খরচ, বা এডমিন হলে সবার খরচ এডিট/মুছতে পারবে
create policy "expenses update" on public.expenses for update to authenticated
  using (public.is_active_user() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));
create policy "expenses delete" on public.expenses for delete to authenticated
  using (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));

-- ---------- রসিদের ছবি রাখার জায়গা (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 8388608,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "receipts read"   on storage.objects;
drop policy if exists "receipts upload" on storage.objects;
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_active_user());
-- প্রত্যেকে নিজের ফোল্ডারে (user id) আপলোড করবে
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- শুরুর খাতগুলো (প্রথমবার) ----------
insert into public.categories (name, sort_order)
select n, o from (values
  ('খাবার (Food)', 1), ('যাতায়াত (Transport)', 2), ('জ্বালানি (Fuel)', 3),
  ('নির্মাণ সামগ্রী (Materials)', 4), ('শ্রমিক মজুরি (Labour)', 5),
  ('যন্ত্রপাতি ভাড়া (Equipment)', 6), ('অফিস খরচ (Office)', 7), ('অন্যান্য (Other)', 8)
) v(n, o)
where not exists (select 1 from public.categories);

-- =====================================================================
-- প্রথম এডমিন বানানো: ইউজার তৈরির পর নিচের লাইনে নিজের ইমেইল বসিয়ে আলাদা করে চালান
-- update public.profiles set role = 'admin', active = true, full_name = 'Admin'
--   where id = (select id from auth.users where email = 'your-email@example.com');
-- =====================================================================
