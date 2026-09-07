export interface CrashAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface CrashScreenProps {
  title: string;
  /** One sentence on what the user can do about it. */
  body: string;
  error: Error;
  actions: CrashAction[];
  /** Fills its container instead of the viewport (used inside the editor). */
  inline?: boolean;
}

/**
 * Fallback UI for ErrorBoundary. Says what broke in plain words, offers a way
 * out, and keeps the raw error one click away for bug reports.
 */
export default function CrashScreen({ title, body, error, actions, inline = false }: CrashScreenProps) {
  return (
    <div className={inline ? 'crash-screen crash-screen--inline' : 'crash-screen'} role="alert">
      <div className="crash-card">
        <p className="beta-eyebrow">Something went wrong</p>
        <h1>{title}</h1>
        <p className="crash-body">{body}</p>
        <div className="crash-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.primary ? 'btn-cta' : 'btn-login'}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
        <details className="crash-detail">
          <summary>Technical details</summary>
          <pre>{error.stack || error.message || String(error)}</pre>
        </details>
      </div>
    </div>
  );
}
