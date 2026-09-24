-- Only the gateway may mutate jobs. User JWTs can read their own job metadata.
create table public.render_jobs (
  id uuid primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  status text not null default 'SUBMITTING' check (status in
    ('SUBMITTING','IN_QUEUE','IN_PROGRESS','COMPLETED','FAILED','CANCELLED','TIMED_OUT')),
  runpod_id text unique,
  contract jsonb not null,
  result_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index render_jobs_owner_created on public.render_jobs(owner, created_at desc);
alter table public.render_jobs enable row level security;
revoke all on public.render_jobs from anon, authenticated;
grant select on public.render_jobs to authenticated;
grant all on public.render_jobs to service_role;
create policy "render_jobs: owner read" on public.render_jobs for select to authenticated using (owner = auth.uid());

-- Serialize reservations to enforce limits even across simultaneous requests.
create function public.reserve_render_job(p_owner uuid, p_job uuid, p_contract jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(2409240900);
  if exists(select 1 from public.render_jobs where id=p_job and owner=p_owner) then return false; end if;
  if not exists(select 1 from public.waitlist where user_id=p_owner and status='active') then
    raise exception 'Active beta access required';
  end if;
  if exists(select 1 from public.render_jobs where owner=p_owner and expires_at>now()
    and status in ('SUBMITTING','IN_QUEUE','IN_PROGRESS')) then
    raise exception 'A render is already running. Wait or cancel it first.';
  end if;
  if (select count(*) from public.render_jobs where owner=p_owner and created_at>now()-interval '1 hour') >= 10
    or (select count(*) from public.render_jobs where owner=p_owner and created_at>now()-interval '1 day') >= 30
    or (select count(*) from public.render_jobs where created_at>now()-interval '1 day') >= 100 then
    raise exception 'Render limit reached. Please try again later.';
  end if;
  insert into public.render_jobs(id,owner,contract) values(p_job,p_owner,p_contract);
  return true;
end $$;
revoke all on function public.reserve_render_job(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_render_job(uuid,uuid,jsonb) to service_role;
