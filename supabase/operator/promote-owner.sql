-- Operator-only setup. Replace the email after creating the user with a password
-- and Auto Confirm User in Supabase Authentication. Never put a password here.
-- This is intentionally NOT an automatic migration.
begin;
do $$
declare
  owner_email text := 'REPLACE_WITH_OWNER_EMAIL';
  owner_id uuid;
begin
  select id into owner_id from auth.users
    where lower(email)=lower(owner_email) and email_confirmed_at is not null
      and encrypted_password is not null and encrypted_password <> '';
  if owner_id is null then
    raise exception 'Create the confirmed password account first';
  end if;
  update public.profiles set is_admin=true where user_id=owner_id;
  if not found then raise exception 'Account profile missing'; end if;
  insert into public.waitlist(email,status,user_id,source,activated_at)
    values(lower(owner_email),'active',owner_id,'owner-setup',now())
    on conflict(email) do update set status='active',user_id=excluded.user_id,
      activated_at=coalesce(public.waitlist.activated_at,now());
end $$;
commit;
