# Supabase render gateway

The website submits jobs through `render-job`; only this function holds the RunPod API key. Every action verifies a live Supabase user session, confirmed email, and active waitlist membership. Status and cancellation look up the job by both ID and owner before contacting RunPod.

## Deployment

1. Apply `supabase/migrations/20260924090000_render_jobs.sql`.
2. Set `RUNPOD_API_KEY` in Supabase Edge Function secrets. The existing project secret named `smart-ink` is supported as a fallback. Never use a VITE variable for this secret.
3. Deploy `supabase/functions/render-job/index.ts` with JWT verification enabled. It uses Supabase's default URL and service-role environment variables.
4. Set `VITE_RENDER_BACKEND=runpod` in the frontend build environment and rebuild. Supabase URL and publishable key must also be configured.

Optional server secrets: `RUNPOD_ENDPOINT_ID` (defaults to `diyhc9fflfp8rj`) and `RENDER_ALLOWED_ORIGINS` (comma-separated exact origins; defaults to the stable beta Pages domain and localhost port 5173). Preview deployments need their own origin explicitly allowed before rendering.

## Limits and behavior

- One active render per user; 10 reservations/hour, 30/day per user, 100/day globally. Failed attempts count. Reservations expire after 30 minutes. A database advisory lock prevents concurrent requests from exceeding quotas.
- Up to 2048 pixels per edge, 512 samples, 6 MiB ink PNG and 5 MiB output PNG. The frontend scales larger exports to 2048 pixels while preserving aspect ratio.
- RunPod execution timeout is 11 minutes; job TTL is 15 minutes. Submission is never automatically retried because a lost response could create duplicate billable work.
- Polling returns progress and preview images. Completed images are saved in the private `renders` bucket and added to render history before completion is reported. Chunked results are decoded individually and reassembled.
- Keep the page open until completion. Persistence currently happens during polling; closing the browser early can leave a result unsaved. There is no background webhook or resume-on-reload yet.
- Cancellation is best effort, with unconfirmed cancellation reported explicitly. Snapshot cancellation stops waiting immediately and explains that the render may still finish.
- Full signed-in production testing requires working email delivery or another configured login provider. Public rejection/CORS checks do not prove the RunPod secret is valid.

## Checks

`deno test tools/render-gateway.test.ts`, `node tools/runpod-render-service.test.mjs`, `node tools/render-service.test.mjs`, `npm run typecheck`, and `npm run build`.

To roll back the frontend transport, set `VITE_RENDER_BACKEND=http` and rebuild. The HTTP renderer then uses the existing `VITE_RENDER_URL`. Keep the private job table for history and diagnostics.
