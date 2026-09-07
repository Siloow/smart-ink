# Smart Ink beta — improvement plan

Branch: `beta-improvements` (cut from `beta` at `1f8bd4f`, 2026-09-07).

This is a read of the beta as it stands on the branch, followed by a phased plan. Every finding below was checked against the code, the build output, or the toolchain in this session; nothing is guessed.

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Stabilize | Done 2026-09-07 | Typecheck and lint pass; CI added; error boundaries; dead controls and placeholder content removed; Pose hidden; backups and stray files untracked. |
| 1 — Lean build | Not started | |
| 2 — A real gate | Not started | Interim: set `VITE_WAITLIST_ENDPOINT` so leads stop being dropped. |
| 3 — Scenes follow the user | Not started | |
| 4 — Render service | Not started | |
| 5 — Learn from testers | Not started | |

## Where the beta stands

| Check | Result |
| --- | --- |
| `npm run typecheck` | 2 errors |
| `npm run lint` | 3 errors, 2 warnings |
| `npm run build` | passes, `dist/` = 207 MB |
| Main JS chunk | 1.2 MB (348 KB gzip), one chunk |
| Tests | none |
| CI | none |
| Deploy config in repo | none |

### Blockers — outside testers cannot get in

1. **Invites do not cross devices.** Waitlist, invites, the active list and the session all live in the browser's `localStorage` (`src/auth/betaAuthStore.ts`). An invite minted in the operator console on your machine does not exist in a tester's browser, so every invite link ends in "This invite code was not found" (`getInvite` reads the local snapshot only).
2. **Waitlist leads are dropped.** `VITE_WAITLIST_ENDPOINT` is not set in `.env.production`. The landing form stores the email in the visitor's own browser, logs a console warning, and shows "You're on the list." You never see the address.
3. **Sign-in is a demo.** The email code is a constant (`482913`) printed in the UI. "Continue with Google" accepts any typed email that has been invited. Nothing verifies identity.
4. **Operator console is public.** `?admin=1` reaches it from any browser, and the unlock screen prints the passphrase (`smartink-beta`).

### Serious — will hurt testers or you within days

5. **The build ships 207 MB.** `public/smartink-live` is a symlink into the Blender working tree, so `vite build` copies 158 MB of `.blend`, `.blend1` and texture files into `dist/`, plus a 30 MB `human.obj` the browser never loads. The browser needs about 15 MB of meshes (`forearm.obj`, `monk.glb`, `human_arm_rig.glb`, `FinalBaseMesh.obj`) and the logo texture.
6. **Typecheck and lint fail.** `tsc -b`: unused `React` import in `src/CinematicLights.tsx:1`; `BufferAttribute` type mismatch in `src/ModelWithUVTattoo.tsx:130`. ESLint: unused vars at `src/App.tsx:356` and `src/sceneStorage.ts:64`. There is no CI to catch regressions and no test of any kind.
7. **The Pose selector does nothing.** `poseId` never reaches `ModelWithUVTattoo`, and `apply_pose` in `smartink-live/sceneImporter.py` is a stub. A tester picks "Arm extended" and nothing changes in the preview or the render.
8. **Cloud render is open and synchronous.** `/render-v2` has no auth or rate limit, and the request is held open for up to 180 s. A Cloud Run cold start plus a 256-sample CPU Cycles render will regularly exceed browser and proxy timeouts. The Cloud Run service's source is not in this branch; only the local `server/app.py` is.
9. **No error boundary.** A failed mesh load or a lost WebGL context throws through the R3F `Canvas` to the root. There is no React error boundary or Suspense fallback anywhere in `src/`, so the tester sees a white page.
10. **Everything is per-browser.** Scenes (`localStorage` + IndexedDB), render history and the session vanish when a tester clears site data or switches device. The "Share" button in the editor toolbar is a no-op.

### Polish — visible, cheap

11. **Dead ends.** "Share", "Templates", "Help & Feedback", "Privacy" and "Terms" do nothing. The favicon (`/vite.svg`) 404s. Body and look thumbnails (`/builder/*.jpg`) 404 and are hidden on error, so the Body cards are text-only.
12. **Login showcase is placeholder.** The right column of `LoginPage` is four emoji tiles credited to `@DesignGabor`, `@heyvlad`, `@elcord`. It reads as template leftover and attributes work to people who did not do it.
13. **Repo weight.** Six `.blend1` backup files (30 MB) are tracked, `src.zip` sits at the root, and the 42 MB `rp_posed_00178_29_BLD` model is referenced by nothing.
14. **Single JS chunk.** The landing page loads the whole editor bundle. `HeroPreview` needs three.js, but not drei, the editor, or the storage layers.
15. **Blender asset names are fiction.** The registry's `body_full.blend`, `forearm.blend`, `human.blend` do not exist; the importer silently falls back to the OBJ/GLB preview meshes. `assets/bodies.blend`, `looks.blend`, `poses.blend` exist and are unreferenced. If no body loads at all, the importer renders a cube instead of failing.

Also pending in the working tree: the uncommitted dev-admin shortcut in `LoginPage.tsx` and `betaAuthService.ts`. It is `import.meta.env.DEV`-guarded and stripped from production builds, so it is safe to keep. Decide in Phase 0.

## The plan

Estimates are for one developer and are rough. Phases 0–2 plus the feedback form from Phase 5 are the critical path to the first five outside testers. Phases 3 and 4 can land while those testers are using it.

### Phase 0 — Stabilize (≈1 day)

- Fix the 2 type errors and 3 lint errors. Make `typecheck && lint && build` the merge gate.
- Add a GitHub Actions workflow: install, typecheck, lint, build, and print `dist/` size so the 207 MB regression can never come back unnoticed.
- Add a root error boundary with a "Reload" / "Back to scenes" fallback, and a Suspense fallback around the editor `Canvas`.
- Fix the favicon. Remove or hide the dead links; Help & Feedback returns in Phase 5 with a real form.
- Hide the Pose section until Phase 3 wires it. A control that does nothing erodes trust faster than a missing one.
- Replace the login showcase tiles with real captures, or drop the right column.
- Repo hygiene: `git rm --cached` the `.blend1` files, `src.zip`, and `rp_posed_*`; add them to `.gitignore`; keep them on disk.
- Decide on the pending dev-admin change: commit it or drop it.

### Phase 1 — Lean, deployable build (≈1 day)

- Replace the `public/smartink-live` symlink with a `public/models/` folder holding only what the browser loads. Point the two script download links in `App.tsx` at `/blender-scripts/` (already in `public/`). Expected: `dist/` from 207 MB to about 16 MB.
- Compress `logo.png` (1.4 MB). It is loaded as a texture; 512 px is plenty.
- Code-split: lazy-import the editor branch of `App` so landing and login never pay for drei, the storage layers, or the export modal. Add a `manualChunks` entry for `three`.
- Convert `FinalBaseMesh.obj` (2.5 MB) to a compressed `.glb`; it is the default body and the largest single browser asset.
- Commit a deploy config for whichever host you choose (Firebase Hosting, Vercel, or a Cloud Run static bucket) and a `.env.production` that sets both the render URL and the waitlist endpoint.

### Phase 2 — A real gate (≈3–4 days) — the blocker

- Backend: Supabase, which `.env.example` already anticipates. Email magic link or OTP replaces the constant code; Google OAuth replaces the fake button.
- Tables: `waitlist(email, status, source, referrer, created_at, invited_at, activated_at)`, `invites(code, email, created_by, expires_at, redeemed_at, redeemed_by)`, `profiles(user_id, is_admin)`. Row-level security: users read their own rows; admins read all. Redemption goes through a `redeem_invite(code)` RPC with definer rights so the invite table is never client-readable.
- Keep the `betaAuthService` function surface and make it async; the pages change minimally. Delete `betaAuthStore` once migrated.
- Landing form inserts into `waitlist` directly. Interim, today: set `VITE_WAITLIST_ENDPOINT` to a Formspree or Tally endpoint so leads stop being dropped. That is a ten-minute change.
- Operator console: `?admin=1` requires a signed-in admin. Remove the passphrase and its on-screen hint. "Approve" inserts the invite and sends the email (Supabase Edge Function plus Resend) instead of copying a link to the clipboard.
- Supabase session replaces `snap.session`. Add "Sign out everywhere."

### Phase 3 — Scenes that follow the user (≈3 days)

- Tables: `scenes(id, owner, name, data, updated_at)`; Storage buckets for the decal PNG, the thumbnail and renders. Keep IndexedDB as a write-through cache and migrate existing local scenes on first sign-in.
- Thumbnail capture: debounce to idle. Today every state change re-encodes a full-resolution PNG data URL and rewrites `localStorage`.
- "Share": a signed read-only URL to a render in Storage. Smallest version that is useful to a tattoo artist showing a client.
- Pose: either implement it in both the preview (pose clips in the `.glb`) and Blender (`poses.blend`), or delete it from the registry.

### Phase 4 — A render service you can trust (≈3 days)

- Bring the Cloud Run service source into `server/` with a Dockerfile on a Blender image, so local and cloud run the same code path.
- Require a Supabase JWT on `/render-v2`. Per-user rate limit for the beta, for example ten final-tier renders a day.
- Async jobs: `POST` returns a `job_id`; the client polls `/jobs/:id` or subscribes through Supabase Realtime; output is written to Storage and the history entry stores the URL. This removes the 180 s held connection and lets you show queue position.
- Wire the real `.blend` bodies and looks, or remove the `blendAsset` names. Make the fallback loud: fail the render rather than render a cube.
- Golden-image check in CI: render `tools/fixtures/*.json` at preview tier in a Blender container and diff against committed references.

### Phase 5 — Learn from testers (≈2 days)

- "Help & Feedback" becomes an in-app form that posts to `feedback(user, scene_id, message, user_agent, screenshot)`. The operator console lists it. Build this before inviting anyone.
- Product analytics (PostHog or Plausible) with six events: `request_access`, `invite_redeemed`, `scene_created`, `tattoo_placed`, `export_canvas`, `render_cloud`. Operator console shows active users, last seen and renders per user.
- First-run onboarding in the editor. The ⌘-drag placement gesture is undiscoverable. Three coach marks (upload, click to place, ⌘-drag to nudge) and three sample tattoo PNGs so a tester can try it without their own art.
- A short changelog page and a way to email all active testers.

### Parked

Undo/redo, a tablet layout for the editor (it is desktop-only today), more bodies, subsurface skin, depth of field, print templates.

## Launch checklist

The beta is ready for outside testers when all of these are true.

- [ ] CI is green on typecheck, lint and build.
- [ ] `dist/` is under 25 MB and the editor is lazy-loaded.
- [ ] An invite minted on the operator's machine redeems on a different device.
- [ ] A landing-form email lands in the database and you get a notification.
- [ ] No passphrase or code is shown in the UI; the admin route requires an admin account.
- [ ] The error boundary has been exercised by forcing a mesh 404.
- [ ] Cloud render requires auth and returns a preview-tier image in roughly ten seconds.
- [ ] The feedback form reaches you.
- [ ] A privacy note exists, since you are storing emails.

## Working the branch

Work each phase as its own PR from `beta-improvements` into `beta`; merge `beta` into `main` when the launch checklist is green. Phase 0 and Phase 1 are small enough to be one PR each and should land first so the rest is built on a passing toolchain.
