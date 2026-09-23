# Progressive snapshot rendering

Snapshot requests opt into newline-delimited JSON using the Accept header on `/render-v2`. Existing image-only callers and older PNG-only servers remain compatible.

One Blender process loads the scene once, renders a preview at approximately 512px / 16 samples with the same camera and grading, then restores the requested resolution and samples for the final image. The preview is intentionally separate work; it is not accumulated into the final render.

The snapshot overlay reduces blur from 4px to 0.7px using actual final sample counts, then crossfades for 550ms only after the final image loads. Preparation remains indeterminate. A completed sample count does not imply denoising or PNG delivery is finished. Reduced motion disables the blur effect and transitions. Previews are never saved to history or substituted for a completed download.

The streaming backend enables Blender 5.2 render debug logging to expose sample counts. Backpressure from the browser does not block Blender log output. Disconnect and cancellation terminate the Blender process group, release the render slot, and remove temporary files. The existing server capacity limit remains unchanged; there is no invented queue position.

Validation: frontend typecheck/build, service/session/overlay regression tests, fragmented-stream and stale-preview tests, nine real HTTP/process integration tests, and a real Blender 5.2.1 Metal preview/final render. Visual browser inspection could not run because the browser security policy check was unavailable.

Production requires deploying both the updated API/importer and frontend. Older backends continue returning a single final image.
