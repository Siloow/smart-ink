import { useState, type FormEvent } from 'react';
import { getInvite } from './auth/betaAuthService';

interface InviteCodeEntryProps {
  onBack: () => void;
  onContinue: (code: string) => void;
}

export default function InviteCodeEntry({ onBack, onContinue }: InviteCodeEntryProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setBusy(true);
    try {
      const invite = await getInvite(normalized);
      if (!invite) {
        setError('That invite code is not valid.');
        return;
      }
      onContinue(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="beta-gate-page">
      <div className="beta-gate-card">
        <button type="button" className="beta-link-btn" onClick={onBack}>
          ← Back
        </button>
        <p className="beta-eyebrow">Private beta</p>
        <h1>Enter invite code</h1>
        <p className="beta-lead">Paste the code from your invite email or link.</p>
        <form className="beta-form" onSubmit={handleSubmit}>
          <label className="beta-label" htmlFor="manual-invite-code">
            Invite code
          </label>
          <input
            id="manual-invite-code"
            className="login-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
            required
            autoComplete="off"
          />
          {error && <p className="beta-error">{error}</p>}
          <button type="submit" className="btn-cta" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
