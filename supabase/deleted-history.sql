-- =====================================================================
-- MTC খরচ হিসাব — মুছে ফেলা খরচ এডমিনের কাছে থেকে যাবে
-- সদস্য খরচ "মুছলে" সেটা আসলে মুছে যায় না: সবার তালিকা ও হিসাব থেকে সরে যায়,
-- কিন্তু এডমিন "মুছে ফেলা খরচ" পাতায় দেখতে পান (কে, কখন মুছেছে),
-- চাইলে ফেরত আনতে বা স্থায়ীভাবে মুছতে পারেন। রসিদের ছবিও থেকে যায়।
-- Supabase → SQL Editor → New query → এই পুরো ফাইল পেস্ট করে Run। একাধিকবার চালালেও সমস্যা নেই।
-- =====================================================================

alter table public.expenses add column if not exists deleted_at timestamptz;
alter table public.expenses add column if not exists deleted_by uuid references public.profiles(id);
create index if not exists expenses_deleted_idx on public.expenses(deleted_at);

-- মুছে ফেলা খরচ শুধু এডমিন দেখবেন
drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated
  using (public.is_active_user() and (deleted_at is null or public.is_admin()));

-- আসল (স্থায়ী) মুছে ফেলা শুধু এডমিন পারবেন
drop policy if exists "expenses delete" on public.expenses;
create policy "expenses delete" on public.expenses for delete to authenticated
  using (public.is_admin());

-- সদস্য সরাসরি deleted_at বদলাতে বা মুছে ফেলা খরচ এডিট করতে পারবে না
create or replace function public.guard_expense_soft_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('mtc.soft_delete', true), '') <> 'on' and not public.is_admin()
     and (old.deleted_at is not null or new.deleted_at is distinct from old.deleted_at
          or new.deleted_by is distinct from old.deleted_by) then
    raise exception 'মুছে ফেলা খরচ শুধু এডমিন বদলাতে পারবেন';
  end if;
  if new.deleted_at is null then new.deleted_by := null; end if;
  return new;
end $$;
drop trigger if exists expenses_soft_delete on public.expenses;
create trigger expenses_soft_delete before update on public.expenses
  for each row execute function public.guard_expense_soft_delete();

-- "মুছুন" বাটন এই ফাংশন চালায়: নিজের খরচ (এডমিন হলে যেকোনো খরচ) মুছে ফেলা তালিকায় যায়
create or replace function public.delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'অনুমতি নেই'; end if;
  perform set_config('mtc.soft_delete', 'on', true);
  update public.expenses set deleted_at = now(), deleted_by = auth.uid()
   where id = p_id and deleted_at is null and (user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'এই খরচ মোছার অনুমতি আপনার নেই'; end if;
end $$;
revoke all on function public.delete_expense(bigint) from public, anon;
grant execute on function public.delete_expense(bigint) to authenticated;

-- মাসভিত্তিক মোট থেকে মুছে ফেলা খরচ বাদ
create or replace function public.monthly_totals(max_months int default 12)
returns table (month text, total numeric, entries bigint)
language sql stable security invoker as $$
  select to_char(expense_date, 'YYYY-MM') as month, sum(amount), count(*)
  from public.expenses where deleted_at is null group by 1 order by 1 desc limit max_months
$$;

-- রসিদের ছবি শুধু এডমিন মুছতে পারবেন
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

notify pgrst, 'reload schema';
