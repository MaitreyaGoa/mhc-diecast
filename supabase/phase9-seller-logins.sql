-- =====================================================================
--  MHC Diecast — seller logins with default password + forced change
--  Run ONCE in Supabase → SQL Editor, after phase8-buyers.sql.
--  Safe to run again (existing logins and passwords are left alone).
-- =====================================================================

-- >>> Default password for NEW seller logins and for admin "Reset password".
--     Sellers must change it on first login. Change 'abcd' here if you like.
create or replace function public.default_seller_password()
returns text language sql immutable as $$ select 'abcd' $$;
revoke execute on function public.default_seller_password() from public, anon, authenticated;

-- ---------- 1. Seller table changes ------------------------------------
alter table public.sellers add column if not exists must_change_password boolean not null default false;
alter table public.sellers alter column whatsapp drop not null;    -- seller fills it on first login

-- Sellers can't change their login, active status or password flag themselves;
-- WhatsApp is checked whenever it is filled in.
create or replace function public.sellers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.is_active is distinct from old.is_active
       or new.login_email is distinct from old.login_email then
      raise exception 'Only the master admin can change login or active status';
    end if;
    if new.must_change_password is distinct from old.must_change_password
       and coalesce(current_setting('mhc.password_flag', true), '') <> 'on' then
      raise exception 'Use Change password to update your password';
    end if;
  end if;
  new.whatsapp := nullif(regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g'), '');
  if new.whatsapp is not null then
    if length(new.whatsapp) = 12 and new.whatsapp like '91%' then new.whatsapp := substr(new.whatsapp, 3); end if;
    if new.whatsapp !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- A seller still on the default password can't see or change any shop data
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sellers where user_id = auth.uid() and is_active and not must_change_password limit 1;
$$;

create or replace function public.admin_list_sellers()
returns setof public.sellers language sql stable security definer set search_path = public as $$
  select * from public.sellers where public.is_admin() order by created_at;
$$;

-- ---------- 2. Create a login (email + password) -----------------------
-- Internal helper: not callable from the website.
create or replace function public._ensure_login(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email: %', p_email; end if;
  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  if v_uid is not null then return v_uid; end if;          -- already exists: keep its password

  v_uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_uid;
end $$;
revoke execute on function public._ensure_login(text, text) from public, anon, authenticated;

-- ---------- 3. Master: create/link a seller's login --------------------
create or replace function public.admin_create_seller_login(p_seller uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_new boolean;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  v_new := not exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
  v_uid := public._ensure_login(p_email, public.default_seller_password());
  if exists (select 1 from public.sellers where user_id = v_uid and id <> p_seller) then
    raise exception 'That email is already linked to another seller';
  end if;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers
     set user_id = v_uid, login_email = lower(trim(p_email)),
         must_change_password = case when v_new then true else must_change_password end
   where id = p_seller;
  return case when v_new then 'created' else 'linked' end;
end $$;
grant execute on function public.admin_create_seller_login(uuid, text) to authenticated;

-- ---------- 4. Master: reset a seller's password to the default --------
create or replace function public.admin_reset_seller_password(p_seller uuid)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  select user_id into v_uid from public.sellers where id = p_seller;
  if v_uid is null then raise exception 'This seller has no login yet'; end if;
  if v_uid = auth.uid() then raise exception 'Change your own password in My shop'; end if;
  update auth.users set encrypted_password = crypt(public.default_seller_password(), gen_salt('bf')),
                        updated_at = now() where id = v_uid;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers set must_change_password = true where id = p_seller;
end $$;
grant execute on function public.admin_reset_seller_password(uuid) to authenticated;

-- ---------- 5. Anyone signed in with email: set a new password ----------
create or replace function public.set_my_password(p_new text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please log in again'; end if;
  if length(coalesce(p_new, '')) < 8 then raise exception 'Use at least 8 characters'; end if;
  if p_new = public.default_seller_password() then raise exception 'Choose a password different from the default'; end if;
  update auth.users set encrypted_password = crypt(p_new, gen_salt('bf')), updated_at = now() where id = v_uid;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers set must_change_password = false where user_id = v_uid;
end $$;
revoke execute on function public.set_my_password(text) from anon;
grant execute on function public.set_my_password(text) to authenticated;

-- ---------- 6. The 5 sellers -------------------------------------------
-- Creates each login (password = default above) and a seller shop for it.
-- Edit the list to add more later; existing ones are skipped.
do $$
declare e text; v_uid uuid;
begin
  foreach e in array array[
    'sharmaprateek.dev@gmail.com',
    'harish@mhc.com',
    'omkar@mhc.com',
    'seller1@mhc.com',
    'seller2@mhc.com'
  ] loop
    v_uid := public._ensure_login(e, public.default_seller_password());
    if not exists (select 1 from public.sellers where user_id = v_uid) then
      insert into public.sellers (user_id, login_email, shop_name, whatsapp, must_change_password, outside_goa_shipping)
      values (v_uid, lower(e), initcap(replace(split_part(e, '@', 1), '.', ' ')), null, true, 100);
    end if;
  end loop;
end $$;

-- Check: the 5 sellers and whether they still need to change the default password
select shop_name, login_email, must_change_password as on_default_password
  from public.sellers order by created_at;
