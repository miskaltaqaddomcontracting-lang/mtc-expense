-- =====================================================================
-- এডমিন প্যানেল থেকে ইউজার যোগ / পাসওয়ার্ড বদল
-- Supabase → SQL Editor → New query → পুরোটা পেস্ট করে Run। একাধিকবার চালালেও সমস্যা নেই।
-- প্রতিটি ফাংশন আগে দেখে নেয় যে চালাচ্ছেন তিনি সক্রিয় এডমিন কিনা।
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- সব ইউজারের ইমেইল ও শেষ লগইন (শুধু এডমিন দেখতে পারবে)
create or replace function public.admin_list_users()
returns table (id uuid, email text, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'শুধু এডমিন এটা করতে পারবেন'; end if;
  return query select u.id, u.email::text, u.last_sign_in_at from auth.users u;
end $$;

-- নতুন ইউজার তৈরি (সাথে সাথে সক্রিয়)
create or replace function public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text default 'member')
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'শুধু এডমিন এটা করতে পারবেন'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'সঠিক ইমেইল/ইউজারনেম দিন'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে'; end if;
  if p_role not in ('admin', 'member') then raise exception 'ভুল ভূমিকা'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'এই ইউজারনেম/ইমেইল আগে থেকেই আছে'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_full_name),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now());

  -- trigger নিষ্ক্রিয় profile বানায়; এডমিন নিজে যোগ করছেন বলে সক্রিয় করে দেওয়া হলো
  insert into public.profiles (id, full_name, role, active) values (v_id, p_full_name, p_role, true)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;
  return v_id;
end $$;

-- কারো পাসওয়ার্ড বদলানো
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'শুধু এডমিন এটা করতে পারবেন'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user_id;
  if not found then raise exception 'ইউজার পাওয়া যায়নি'; end if;
end $$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_create_user(text, text, text, text) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_create_user(text, text, text, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

notify pgrst, 'reload schema';
