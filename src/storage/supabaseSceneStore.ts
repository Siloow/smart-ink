/**
 * Hosted scene store. Settings go to public.scenes as JSON; the decal PNG and
 * the thumbnail go to the private 'scene-assets' bucket and come back as
 * signed URLs, which <img> and three.js load like any other URL.
 *
 * The editor saves on every change, so uploads are skipped when the inline
 * image is the same string that was uploaded last time.
 */
import { getSupabase } from '../auth/supabaseClient';
import type { SceneData } from '../types';
import { dataUrlToBlob, isDataUrl } from './dataUrl';
import { localSceneStore } from './localSceneStore';
import { migrateScene, type SceneStore } from './sceneStoreTypes';

const BUCKET = 'scene-assets';
const SIGNED_URL_TTL_SEC = 60 * 60;

type PersistedScene = Omit<SceneData, 'decalImage' | 'thumbnail'>;

interface SceneRow {
  id: string;
  owner: string;
  name: string;
  data: PersistedScene;
  decal_path: string | null;
  thumb_path: string | null;
  created_at: string;
  updated_at: string;
}

/** Last inline image uploaded per scene, so repeated saves do not re-upload. */
const uploaded = new Map<string, { decal?: string; thumb?: string }>();

async function currentUserId(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Sign in to save scenes.');
  return uid;
}

function decalPath(uid: string, id: string) {
  return `${uid}/${id}/decal.png`;
}

function thumbPath(uid: string, id: string) {
  return `${uid}/${id}/thumb.png`;
}

async function uploadPng(path: string, dataUrl: string): Promise<void> {
  const blob = await dataUrlToBlob(dataUrl);
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/png', cacheControl: '3600' });
  if (error) throw new Error(`Could not upload ${path.split('/').pop()}: ${error.message}`);
}

async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await getSupabase().storage.from(BUCKET).remove(paths);
}

async function signAll(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC);
  if (error) throw new Error(`Could not load scene images: ${error.message}`);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}

async function toSceneData(rows: SceneRow[]): Promise<SceneData[]> {
  const paths = rows.flatMap((r) => [r.decal_path, r.thumb_path]).filter((p): p is string => Boolean(p));
  const urls = await signAll(paths);
  return rows.map((r) =>
    migrateScene({
      ...r.data,
      id: r.id,
      name: r.name,
      decalImage: r.decal_path ? (urls.get(r.decal_path) ?? null) : null,
      thumbnail: r.thumb_path ? (urls.get(r.thumb_path) ?? null) : null,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      createdBy: r.owner,
    })
  );
}

/**
 * Writes settings and any new inline images. `decalImage`/`thumbnail` may be
 * a data URL (upload it), a signed URL from a previous load (keep the stored
 * object), or null (remove it).
 */
async function upsertScene(scene: SceneData): Promise<void> {
  const uid = await currentUserId();
  const prev = uploaded.get(scene.id) ?? {};
  const dPath = decalPath(uid, scene.id);
  const tPath = thumbPath(uid, scene.id);
  const toRemove: string[] = [];

  if (isDataUrl(scene.decalImage)) {
    if (prev.decal !== scene.decalImage) {
      await uploadPng(dPath, scene.decalImage);
      prev.decal = scene.decalImage;
    }
  } else if (!scene.decalImage) {
    toRemove.push(dPath);
    prev.decal = undefined;
  }

  if (isDataUrl(scene.thumbnail)) {
    if (prev.thumb !== scene.thumbnail) {
      await uploadPng(tPath, scene.thumbnail);
      prev.thumb = scene.thumbnail;
    }
  } else if (!scene.thumbnail) {
    toRemove.push(tPath);
    prev.thumb = undefined;
  }
  uploaded.set(scene.id, prev);
  await removeObjects(toRemove);

  const { decalImage: _d, thumbnail: _t, ...data } = scene;
  const { error } = await getSupabase().from('scenes').upsert(
    {
      id: scene.id,
      owner: uid,
      name: scene.name,
      data,
      decal_path: scene.decalImage ? dPath : null,
      thumb_path: scene.thumbnail ? tPath : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`Could not save scene: ${error.message}`);
}

function migrationFlag(uid: string) {
  return `smartink-scenes-migrated:${uid}`;
}

/**
 * First sign-in on a browser that already has local scenes: copy them up
 * once. Local copies are left in place; nothing is deleted on the user's
 * behalf. Runs again on the next load if anything failed.
 */
async function migrateLocalScenesOnce(uid: string): Promise<void> {
  if (localStorage.getItem(migrationFlag(uid))) return;
  const local = await localSceneStore.loadScenes();
  if (local.length === 0) {
    localStorage.setItem(migrationFlag(uid), '1');
    return;
  }
  const { data: existing, error } = await getSupabase().from('scenes').select('id');
  if (error) throw new Error(`Could not check existing scenes: ${error.message}`);
  const have = new Set((existing ?? []).map((r: { id: string }) => r.id));
  for (const scene of local) {
    if (have.has(scene.id)) continue;
    await upsertScene(scene);
  }
  localStorage.setItem(migrationFlag(uid), '1');
  console.info(`[Smart Ink] Copied ${local.length} local scene(s) to your account.`);
}

export const supabaseSceneStore: SceneStore = {
  async loadScenes() {
    const uid = await currentUserId();
    try {
      await migrateLocalScenesOnce(uid);
    } catch (err) {
      console.warn('[Smart Ink] Local scene migration did not finish; will retry next load.', err);
    }
    const { data, error } = await getSupabase()
      .from('scenes')
      .select('id, owner, name, data, decal_path, thumb_path, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(`Could not load scenes: ${error.message}`);
    return toSceneData((data ?? []) as SceneRow[]);
  },

  addScene: upsertScene,
  updateScene: upsertScene,

  async deleteScene(id) {
    const uid = await currentUserId();
    uploaded.delete(id);
    await removeObjects([decalPath(uid, id), thumbPath(uid, id)]);
    const { error } = await getSupabase().from('scenes').delete().eq('id', id);
    if (error) throw new Error(`Could not delete scene: ${error.message}`);
  },

  async getScene(id) {
    await currentUserId();
    const { data, error } = await getSupabase()
      .from('scenes')
      .select('id, owner, name, data, decal_path, thumb_path, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Could not load scene: ${error.message}`);
    if (!data) return undefined;
    const [scene] = await toSceneData([data as SceneRow]);
    return scene;
  },
};
