/**
 * Sends beta requests to a hosted form endpoint (Formspree, Tally, Basin, …).
 *
 * The local beta gate in `betaAuthService` only ever writes to the visitor's own
 * browser, so without a remote endpoint a deployed landing page silently drops
 * every lead. Configure VITE_WAITLIST_ENDPOINT to receive them.
 */

const SUBMIT_TIMEOUT_MS = 10_000;

export const WAITLIST_ENDPOINT: string = (import.meta.env.VITE_WAITLIST_ENDPOINT ?? '').trim();

/** Optional address shown as a fallback when a submission cannot be delivered. */
export const CONTACT_EMAIL: string = (import.meta.env.VITE_CONTACT_EMAIL ?? '').trim();

export function isWaitlistEndpointConfigured(): boolean {
  return WAITLIST_ENDPOINT.length > 0;
}

export interface WaitlistPayload {
  email: string;
  /** Which surface the request came from, so you can compare entry points. */
  source: string;
  referrer?: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; errors?: { message?: string }[] };
    if (body.errors?.length) {
      const joined = body.errors.map((e) => e.message).filter(Boolean).join(', ');
      if (joined) return joined;
    }
    if (body.error) return body.error;
  } catch {
    /* non-JSON error body */
  }
  return `Request failed (${response.status})`;
}

/**
 * Delivers one beta request. Resolves on success, throws otherwise — callers are
 * expected to keep a local copy so a delivery failure never loses the address.
 */
export async function submitWaitlistRequest(payload: WaitlistPayload): Promise<void> {
  if (!isWaitlistEndpointConfigured()) {
    throw new Error('No waitlist endpoint configured.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const response = await fetch(WAITLIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: payload.email,
        source: payload.source,
        referrer: payload.referrer ?? '',
        submittedAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The request timed out.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}
