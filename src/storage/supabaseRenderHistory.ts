/**
 * Hosted render history: rows in public.render_history, PNGs in the private
 * 'renders' bucket under {owner}/{id}.png. Share links are signed URLs the
 * owner creates; anyone holding one can open the image until it expires.
 */
import { getSupabase } from '../auth/supabaseClient';
import {
  newRenderId,
  type RenderHistoryEntry,
  type RenderHistoryStore,
} from './renderHistoryTypes';

const BUCKET = 'renders';
const MAX_ENTRIES = 100;
const SHARE_TTL_SEC = 30 * 24 * 60 * 60;

interface Row {
  id: string;
  owner: string;
  created_at: string;
  source: 'cycles' | 'canvas';
  width: number;
  height: number;
  quality_tier: 'preview' | 'final' | null;
  look_id: string | null;
  scene_name: string | null;
  export_preset: string | null;
  path: string;
}

function mapRow(r: Row): RenderHistoryEntry {
  return {
    id: r.id,
    createdAt: Date.parse(r.created_at),
    source: r.source,
    width: r.width,
    height: r.height,
    qualityTier: r.quality_tier ?? undefined,
    lookId: r.look_id ?? undefined,
    sceneName: r.scene_name ?? undefined,
    exportPreset: r.export_preset ?? undefined,
    path: r.path,
  };
}

async function currentUserId(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Sign in to keep render history.');
  return uid;
}

async function pathFor(id: string): Promise<string> {
  const { data, error } = await getSupabase().from('render_history').select('path').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not find render: ${error.message}`);
  if (!data) throw new Error('Render not found.');
  return (data as { path: string }).path;
}

async function removeRows(rows: { id: string; path: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove(rows.map((r) => r.path));
  const { error } = await supabase
    .from('render_history')
    .delete()
    .in(
      'id',
      rows.map((r) => r.id)
    );
  if (error) throw new Error(`Could not delete render: ${error.message}`);
}

export const supabaseRenderHistory: RenderHistoryStore = {
  async list() {
    await currentUserId();
    const { data, error } = await getSupabase()
      .from('render_history')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Could not load render history: ${error.message}`);
    return ((data ?? []) as Row[]).map(mapRow);
  },

  async add(meta, image) {
    const uid = await currentUserId();
    const id = newRenderId();
    const path = `${uid}/${id}.png`;
    const supabase = getSupabase();
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, image, { contentType: image.type || 'image/png', cacheControl: '3600' });
    if (upErr) throw new Error(`Could not upload render: ${upErr.message}`);

    const { data, error } = await supabase
      .from('render_history')
      .insert({
        id,
        owner: uid,
        source: meta.source,
        width: meta.width,
        height: meta.height,
        quality_tier: meta.qualityTier ?? null,
        look_id: meta.lookId ?? null,
        scene_name: meta.sceneName ?? null,
        export_preset: meta.exportPreset ?? null,
        path,
      })
      .select('*')
      .single();
    if (error) throw new Error(`Could not record render: ${error.message}`);

    // Keep the newest MAX_ENTRIES; storage is cheap but not free.
    const { data: overflow } = await supabase
      .from('render_history')
      .select('id, path')
      .order('created_at', { ascending: false })
      .range(MAX_ENTRIES, MAX_ENTRIES + 50);
    if (overflow && overflow.length > 0) {
      await removeRows(overflow as { id: string; path: string }[]);
    }

    return mapRow(data as Row);
  },

  async getImageBlob(id) {
    const path = await pathFor(id);
    const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
    if (error) throw new Error(`Could not download render: ${error.message}`);
    return data ?? null;
  },

  async remove(id) {
    const path = await pathFor(id);
    await removeRows([{ id, path }]);
  },

  async clear() {
    await currentUserId();
    const { data, error } = await getSupabase().from('render_history').select('id, path');
    if (error) throw new Error(`Could not load render history: ${error.message}`);
    await removeRows((data ?? []) as { id: string; path: string }[]);
  },

  async createShareLink(id) {
    const path = await pathFor(id);
    const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, SHARE_TTL_SEC);
    if (error || !data?.signedUrl) throw new Error(`Could not create a share link: ${error?.message ?? 'unknown error'}`);
    return { url: data.signedUrl, expiresAt: Date.now() + SHARE_TTL_SEC * 1000 };
  },
};
