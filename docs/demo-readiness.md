# Demo reliability pass

Implemented 23 September 2026. The tattoo remains at the selected size; automatic fitting remains disabled.

## The six changes

1. **Saving:** scenes retain custom light positions and backgrounds. A serialized save queue keeps the latest unsaved snapshot after failures, retries before navigation, shows saving/error state, and warns before closing with unsaved work. Dashboard operations show failures and prevent duplicate submissions.
2. **Export consistency:** the selected format controls both canvas and Blender output; Blender previews retain that format at up to 512 px. “Show before” sends a transparent ink layer. Gradient colors come from the same definitions as the viewport. Watermarks are explicitly labeled as canvas-only; Blender uses the chosen lighting look for its studio background.
3. **Photo mode:** hides panels, placement hints, light markers and region highlighting; allows orbiting without accidentally moving the tattoo. Escape or the visible exit button returns to editing. Canvas export excludes helper objects and highlighting and restores renderer state even if rendering fails.
4. **Placement feedback:** fixed size is preserved. Designs exceeding the conservative fit recommendation receive a “may clip” warning. Camera angle changes retain the focused region and fit narrow canvases. Manual orbit and reopened cameras are labeled Custom view. Performance mode no longer dims the lights.
5. **Controls:** removed inactive editor Assets/search controls; retained the working dashboard search. Added male/female selection. Changing the body clears its old triangle anchor while retaining the uploaded artwork and chosen transform, ready for a new placement. Tint is labeled accurately. Sidebars adapt to narrower windows.
6. **Failure handling:** PNGs validate and decode before replacing artwork; cancelled/invalid uploads preserve it. Local renders can be cancelled, timed out, or rejected cleanly. Server health stays responsive during rendering and reports missing setup. Successful images remain downloadable if history storage fails. History thumbnails fail independently.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm run test:demo
npm run test:render-server
```

The demo suite includes placement mathematics, atlas seams and overlap rejection, per-face preview/export masks, retained failed saves and retries, actual Workspace save/thumbnail/navigation wiring, custom lighting, upload failures and races, output formats and backgrounds, photo helper cleanup, camera framing, before/after shot building, service cancellation/timeouts, and the development proxy cancellation hook.

The backend suite uses isolated temporary servers and a controllable Blender stand-in to check validation, concurrency, health responsiveness, cancellation, timeout, malformed output, readiness and sync. It does not alter the user's Blender live scene.

Real Blender was also exercised against the updated server:

- Male final-tier 512×512 PNG: 12.37 s.
- Female with altered shape, deep skin and daylight look, final-tier 512×512: 10.10 s.
- Health request while rendering: below 0.01 s in this check (previously 6.61 s).
- Cancelled real 2048 px / 1024-sample render: active slot released in 0.21 s.
- Transparent 1×1 ink layer produced a clean 288×512 portrait PNG in 9.50 s; visually inspected.
- Malformed JSON now returns 422 before launching Blender; empty ink returns 400.

These timings are local measurements, not performance guarantees. The small renders validate the pipeline and dimensions; they are not a maximum-resolution quality certification.

## Running locally

The app uses its existing local render proxy in development. Start the existing server with `npm run render-server`; it listens on port 8000. The updated proxy forwards a cancelled browser request to Blender so the server can terminate its process. Older hosted render servers remain compatible, but the UI says “Stop waiting” when they do not advertise cancellation support; updating the local code does not deploy the cloud backend.

## Remaining verification limit

Browser automation remains unavailable because its administrator-policy check could not be verified. No workaround was used. Live visual inspection of the updated page, downloaded canvas pixels, real hosted login/storage/share flows, and the Blender GUI watcher remain unverified. The original placement geometry and offline visual checks remain valid; these changes retain the surface-chart mapping and fixed size.

Before presenting, use the live browser once to upload → place → rotate/scale → focus arm → change angle → Photo mode → export → save/reopen. Check the saved lighting and try a before/after Blender export. This is the remaining manual acceptance pass, not a claim that every browser interaction has been certified.
