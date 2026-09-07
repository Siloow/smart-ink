-- Smart Ink private beta gate.
--
-- Three tables and a handful of RPCs. Clients never write to the tables
-- directly: every mutation goes through a SECURITY DEFINER function that
-- validates the request, so the anon key can be public without exposing the
-- invite list. Read access is limited by row-level security.
--
-- Apply with `supabase db push` (see docs/supabase-setup.md) or paste into the
-- SQL editor of a fresh project.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  status       text not null default 'waitlisted'
               check (status in ('waitlisted', 'invited', 'active', 'revoked')),
  source       text,
  referrer     text,
  user_id      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  invited_at   timestamptz,
  activated_at timestamptz
);

create table public.invites (
  code             text primary key,
  email            text,
  note             text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  redeemed_at      timestamptz,
  redeemed_by_email text
);

create index waitlist_status_idx on public.waitlist (status, created_at desc);
create index invites_created_idx on public.invites (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_email(p text)
returns text language sql immutable as $$
  select lower(btrim(p))
$$;

create or replace function public.valid_email(p text)
returns boolean language sql immutable as $$
  select p ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
$$;

-- 8 characters, no 0/O/1/I so codes survive being read out loud.
create or replace function public.gen_invite_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  out text := '';
  i int;
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

-- Every auth user gets a profile row. Admins are promoted by hand:
--   update public.profiles set is_admin = true where email = 'you@studio.com';
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    public.normalize_email(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.user_id = auth.uid()),
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- Row-level security. No insert/update/delete policies on purpose: writes go
-- through the RPCs below.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.waitlist enable row level security;
alter table public.invites  enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (user_id = auth.uid());

create policy "profiles: admins read all"
  on public.profiles for select
  using (public.is_admin());

create policy "waitlist: read own"
  on public.waitlist for select
  using (email = public.normalize_email(auth.jwt() ->> 'email'));

create policy "waitlist: admins read all"
  on public.waitlist for select
  using (public.is_admin());

create policy "invites: admins read all"
  on public.invites for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Public RPCs (anon + authenticated)
-- ---------------------------------------------------------------------------

-- Landing-page form. Idempotent per email.
create or replace function public.request_beta_access(
  p_email text,
  p_source text default null,
  p_referrer text default null
)
returns table (status text, already boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.normalize_email(p_email);
  v_status text;
begin
  if not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.';
  end if;

  select w.status into v_status from public.waitlist w where w.email = v_email;
  if found then
    return query select v_status, true;
    return;
  end if;

  insert into public.waitlist (email, source, referrer)
  values (v_email, left(p_source, 64), left(p_referrer, 512));
  return query select 'waitlisted'::text, false;
end $$;

-- Lets the login page refuse to send a code to an address that was never
-- invited. Reveals whether an email is on the list; acceptable for a
-- hand-run private beta.
create or replace function public.access_status_for_email(p_email text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select w.status from public.waitlist w where w.email = public.normalize_email(p_email)),
    'none'
  )
$$;

create or replace function public.get_invite_public(p_code text)
returns table (code text, email text, expires_at timestamptz, redeemed boolean)
language sql stable security definer set search_path = public as $$
  select i.code, i.email, i.expires_at, i.redeemed_at is not null
  from public.invites i
  where i.code = upper(btrim(p_code))
$$;

create or replace function public.redeem_invite(p_code text, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code  text := upper(btrim(p_code));
  v_email text := public.normalize_email(p_email);
  v_invite public.invites%rowtype;
begin
  if not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.';
  end if;

  select * into v_invite from public.invites where code = v_code for update;
  if not found then
    raise exception 'That invite code is not valid.';
  end if;
  if v_invite.redeemed_at is not null then
    raise exception 'This invite was already used.';
  end if;
  if now() > v_invite.expires_at then
    raise exception 'This invite has expired.';
  end if;
  if v_invite.email is not null and v_invite.email <> v_email then
    raise exception 'This invite is reserved for a different email.';
  end if;

  update public.invites
     set redeemed_at = now(), redeemed_by_email = v_email
   where code = v_code;

  insert into public.waitlist (email, status, source, invited_at)
  values (v_email, 'invited', 'invite:' || v_code, now())
  on conflict (email) do update
     set status = case when public.waitlist.status = 'revoked' then 'revoked' else 'invited' end,
         invited_at = coalesce(public.waitlist.invited_at, now());

  if (select status from public.waitlist where email = v_email) = 'revoked' then
    raise exception 'This beta access was revoked.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Signed-in RPCs
-- ---------------------------------------------------------------------------

-- Called after every sign-in. Promotes 'invited' to 'active', links the auth
-- user, and returns the resulting status so the app can gate on it.
create or replace function public.my_access()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.normalize_email(auth.jwt() ->> 'email');
  v_row public.waitlist%rowtype;
begin
  if auth.uid() is null or v_email is null then
    return 'none';
  end if;

  select * into v_row from public.waitlist where email = v_email for update;
  if not found then
    return 'none';
  end if;

  if v_row.status = 'invited' then
    update public.waitlist
       set status = 'active', activated_at = now(), user_id = auth.uid()
     where id = v_row.id;
    return 'active';
  end if;

  if v_row.status = 'active' and v_row.user_id is null then
    update public.waitlist set user_id = auth.uid() where id = v_row.id;
  end if;

  return v_row.status;
end $$;

-- ---------------------------------------------------------------------------
-- Operator RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_invite(
  p_email text default null,
  p_note text default null
)
returns public.invites
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(public.normalize_email(coalesce(p_email, '')), '');
  v_row public.invites%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Operator access required.';
  end if;
  if v_email is not null and not public.valid_email(v_email) then
    raise exception 'Enter a valid email address.';
  end if;

  insert into public.invites (code, email, note, created_by, expires_at)
  values (public.gen_invite_code(), v_email, left(p_note, 200), auth.uid(), now() + interval '7 days')
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.admin_approve_waitlist(p_entry_id uuid)
returns public.invites
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.waitlist%rowtype;
  v_row public.invites%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Operator access required.';
  end if;

  select * into v_entry from public.waitlist where id = p_entry_id for update;
  if not found then
    raise exception 'Waitlist entry not found.';
  end if;
  if v_entry.status = 'revoked' then
    raise exception 'This entry was revoked.';
  end if;
  if v_entry.status = 'active' then
    raise exception 'Already active — they can log in.';
  end if;

  update public.waitlist
     set status = 'invited', invited_at = now()
   where id = p_entry_id;

  insert into public.invites (code, email, note, created_by, expires_at)
  values (public.gen_invite_code(), v_entry.email, 'Approved from waitlist', auth.uid(), now() + interval '7 days')
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.admin_revoke_access(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Operator access required.';
  end if;
  update public.waitlist set status = 'revoked' where id = p_entry_id;
  if not found then
    raise exception 'Waitlist entry not found.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Tables stay reachable only through RLS-filtered selects; the anon
-- key can call the public RPCs, signed-in users the rest.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.waitlist, public.invites from anon, authenticated;
grant select on public.profiles, public.waitlist, public.invites to authenticated;

grant execute on function public.request_beta_access(text, text, text) to anon, authenticated;
grant execute on function public.access_status_for_email(text) to anon, authenticated;
grant execute on function public.get_invite_public(text) to anon, authenticated;
grant execute on function public.redeem_invite(text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.admin_create_invite(text, text) to authenticated;
grant execute on function public.admin_approve_waitlist(uuid) to authenticated;
grant execute on function public.admin_revoke_access(uuid) to authenticated;
