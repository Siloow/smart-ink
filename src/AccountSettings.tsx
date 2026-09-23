import { useEffect, useState } from 'react';
import type { BetaSession } from './auth/types';
import { authMode } from './auth/betaAuthService';
import { getSupabase } from './auth/supabaseClient';

type Profile = { displayName: string; studioName: string };

export default function AccountSettings({ session, onSignOut }: { session: BetaSession; onSignOut: () => void }) {
  const [profile, setProfile] = useState<Profile>({ displayName: session.displayName, studioName: '' });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = `smartink:profile:${session.email.toLowerCase()}`;
  const hosted = authMode() === 'supabase';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setError('');
    async function load() {
      try {
        let data: Record<string, unknown> = {};
        if (hosted) {
          const result = await getSupabase().auth.getUser();
          if (result.error) throw result.error;
          if (!result.data.user || result.data.user.id !== session.userId) throw new Error('Please sign in again.');
          data = result.data.user.user_metadata;
        } else {
          data = JSON.parse(localStorage.getItem(key) ?? '{}');
        }
        if (!cancelled) { setLoaded(true); setProfile({ displayName: typeof data.full_name === 'string' ? data.full_name : session.displayName, studioName: typeof data.studio_name === 'string' ? data.studio_name : '' }); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your account settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [key, hosted, session.userId, session.displayName, attempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || loading || !loaded) return;
    setSaved(false);
    const name = profile.displayName.trim();
    if (!name) { setError('Enter a display name.'); return; }
    setSaving(true);
    setError('');
    try {
      const data = { full_name: name, studio_name: profile.studioName.trim() };
      if (hosted) {
        const result = await getSupabase().auth.updateUser({ data });
        if (result.error) throw result.error;
      } else {
        localStorage.setItem(key, JSON.stringify(data));
      }
      setProfile({ displayName: name, studioName: data.studio_name });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="account-settings">
    <h1>Account settings</h1>
    <p>Your profile and sign-in details.</p>
    {loading && <p role="status">Loading your settings…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)} disabled={saving}>Reload settings</button></div>}
    <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={loading || saving || !loaded}>
        <label>Display name<input autoComplete="name" value={profile.displayName} maxLength={80} required onChange={(event) => { setProfile({ ...profile, displayName: event.target.value }); setSaved(false); }} /></label>
        <label>Studio name <span className="optional">(optional)</span><input autoComplete="organization" value={profile.studioName} maxLength={120} onChange={(event) => { setProfile({ ...profile, studioName: event.target.value }); setSaved(false); }} /></label>
        <label>Email<input type="email" value={session.email} readOnly /></label>
        <p className="settings-hint">Your email is linked to your invitation and sign-in account.</p>
        <button type="submit" className="btn-create">{saving ? 'Saving…' : 'Save changes'}</button>
      </fieldset>
      {saved && <p role="status">Your account settings have been saved.</p>}
    </form>
    {!hosted && <p className="settings-hint">In demo mode, profile changes are saved in this browser.</p>}
    <div className="settings-session"><h2>Session</h2><p>Signed in with {session.method === 'google' ? 'Google' : 'email'}.</p><button type="button" className="btn-open" onClick={onSignOut} disabled={saving}>Sign out</button></div>
  </section>;
}
