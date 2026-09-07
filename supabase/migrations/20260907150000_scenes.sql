-- Scenes and render history that follow the user.
--
-- Scene settings live as JSON in public.scenes; the decal PNG and the
-- thumbnail live in the private 'scene-assets' bucket under
-- {owner}/{scene id}/decal.png and thumb.png. Renders and canvas exports go
-- to the private 'renders' bucket under {owner}/{render id}.png with a row in
-- public.render_history. Everything is owner-only; sharing a render means the
-- owner creates a signed URL from the client.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.scenes (
  id          text primary key,                       -- client ids predate uuids
  owner       uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'Untitled Scene',
  data        jsonb not null default '{}'::jsonb,      -- SceneData minus decalImage/thumbnail
  decal_path  text,
  thumb_path  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index scenes_owner_updated_idx on public.scenes (owner, updated_at desc);

create table public.render_history (
  id            text primary key,
  owner         uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('cycles', 'canvas')),
  width         int not null,
  height        int not null,
  quality_tier  text,
  look_id       text,
  scene_name    text,
  export_preset text,
  path          text not null
);

create index render_history_owner_created_idx on public.render_history (owner, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: owners only. The operator console does not need these.
-- ---------------------------------------------------------------------------

alter table public.scenes enable row level security;
alter table public.render_history enable row level security;

create policy "scenes: owner select" on public.scenes for select using (owner = auth.uid());
create policy "scenes: owner insert" on public.scenes for insert with check (owner = auth.uid());
create policy "scenes: owner update" on public.scenes for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "scenes: owner delete" on public.scenes for delete using (owner = auth.uid());

create policy "render_history: owner select" on public.render_history for select using (owner = auth.uid());
create policy "render_history: owner insert" on public.render_history for insert with check (owner = auth.uid());
create policy "render_history: owner delete" on public.render_history for delete using (owner = auth.uid());

grant select, insert, update, delete on public.scenes to authenticated;
grant select, insert, delete on public.render_history to authenticated;

-- ---------------------------------------------------------------------------
-- Storage. Private buckets; the first folder of every object is the owner's
-- auth uid, which is what the policies key on.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('scene-assets', 'scene-assets', false, 20971520, array['image/png', 'image/jpeg', 'image/webp']),
  ('renders',      'renders',      false, 52428800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "scene-assets: owner read"
  on storage.objects for select
  using (bucket_id = 'scene-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "scene-assets: owner write"
  on storage.objects for insert
  with check (bucket_id = 'scene-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "scene-assets: owner update"
  on storage.objects for update
  using (bucket_id = 'scene-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "scene-assets: owner delete"
  on storage.objects for delete
  using (bucket_id = 'scene-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "renders: owner read"
  on storage.objects for select
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "renders: owner write"
  on storage.objects for insert
  with check (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "renders: owner update"
  on storage.objects for update
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "renders: owner delete"
  on storage.objects for delete
  using (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);
