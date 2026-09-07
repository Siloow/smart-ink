# Deploying the beta

The app is a static Vite build. Any static host works; the render server is a
separate Cloud Run service that the app reaches over HTTPS.

## Build

```bash
npm ci
npm run typecheck && npm run lint
npm run build
```

`dist/` is about 16 MB: four body meshes (~13 MB, served from `public/models/`),
the app in a few chunks, and the two Blender scripts under `/blender-scripts/`.
CI fails the build if `dist/` grows past 25 MB, which is what happens if the
Blender working tree finds its way back into `public/`.

## Environment

`.env.production` is committed and read at build time:

| Variable | Purpose |
| --- | --- |
| `VITE_RENDER_URL` | The Cloud Run render service. |
| `VITE_WAITLIST_ENDPOINT` | Where landing-page beta requests go. **Empty means requests are lost** (they stay in the visitor's browser). Set it before inviting anyone. |
| `VITE_CONTACT_EMAIL` | Optional fallback address shown if a request cannot be delivered. |

Until Phase 2 of the plan replaces the localStorage gate with a hosted one,
a hosted form endpoint (Formspree, Tally, Basin) is the quickest way to
actually receive requests.

## Host

No host is configured in the repo yet. The render service already runs on
Google Cloud in `europe-west4`, so Firebase Hosting keeps everything in one
project and one bill:

```bash
npm i -g firebase-tools
firebase login
firebase init hosting   # public dir: dist, single-page app: yes, no GitHub deploys yet
npm run build
firebase deploy --only hosting
```

`firebase init` writes `firebase.json` and `.firebaserc`; commit both. Add
long cache headers for `/models/**` and `/assets/**` (hashed filenames), and
`no-cache` for `index.html`.

Vercel or Netlify work the same way: build command `npm run build`, output
directory `dist`, SPA rewrite to `index.html`.

## What the browser actually needs

| Asset | Size | Loaded by |
| --- | --- | --- |
| `models/forearm.obj` | 156 KB | Landing hero |
| `models/FinalBaseMesh.obj` | 2.5 MB | Editor, "Full figure" body |
| `models/monk.glb` | 4.6 MB | Editor, "Forearm" body |
| `models/human_arm_rig.glb` | 6.3 MB | Editor, "Human" body |
| `logo.png` | 107 KB | Editor, default tattoo texture |

The editor fetches only the selected body. Everything else in
`smartink-live/` (the `.blend` files, textures, the 29 MB `human.obj`) is for
Blender and stays out of the build.
