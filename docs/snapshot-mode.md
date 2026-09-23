# Snapshot mode

Choose **Snapshot** in the top toolbar or Photo mode's floating controls. It opens a live composition overlay, smoothly frames the current tattoo, and keeps the camera aimed at its anchor on the posed skin. Rendering starts only when you choose **Render snapshot**.

- **Camera:** adjust the angle around the tattoo, viewing height, and zoom with sliders or exact numeric values. Nudge buttons and arrow keys move 1° or 1%; Shift moves 5° or 10%. **Reset view** restores the automatic composition. Angle and distance limits keep the camera outside the skin.
- **Lighting:** choose a preset, edit individual light position, color, strength and softness, or use **Aim lights at tattoo** to retarget studio lights. Changes are visible before rendering.
- **Hide controls** clears the shot; small viewports start with controls collapsed.
- **Quick:** up to 960 pixels on the long edge, 64 Cycles samples and denoising.
- **Detailed:** up to 1920 pixels on the long edge, 256 samples and denoising.
- **Adjust shot** returns to live composition. **Render again** regenerates the same frozen shot at the selected quality.
- **Compare with live** compares matching shots. Comparison is unavailable when the camera/lights have been recomposed or resizing changes the viewport crop; render the changed shot, or resize back to the captured crop.
- **Download** saves the PNG. Successful renders also go to Render history. The previous successful image remains downloadable if a new render fails or is cancelled.
- **Back to editing** or Escape cancels outstanding work and restores the camera used before opening Snapshot.

The built-in example tattoo is a real export source, shared by the viewport, Snapshot and regular Blender export. No upload is required: click the skin to place it. **Use example tattoo** in the design controls restores it after an upload and keeps the placement. A hidden tattoo remains hidden in the render while retaining its camera anchor. With no tattoo placed, Snapshot frames the visible figure and can render without ink. Covered tattoos or tattoos outside the Focus region fall back to figure framing.

Snapshot uses the actual viewport aspect ratio, independent of the export dialog's social-image format. On Render, it finishes the requested camera transition and freezes shape, pose, focus region, clothes, hair, tattoo placement/tint/opacity, backdrop and custom lights before asynchronous preparation. Rendering preserves the calculated camera and 38° field of view; f/8 keeps more of the tattoo in focus. Lighting edits persist when returning to the editor.

Resources belong to a single visit: cancelled preparation stops image loading, stale render replies cannot replace later results, URLs are released when replaced or closed, and history failure cannot erase a completed image. Switching scenes or leaving the workspace closes the session.

The image is a physical Blender render. Lighting/material appearance differs from the interactive preview. Existing gradient backgrounds still use their first color in Blender; the Studio sweep provides a consistent backdrop. Photographic realism remains limited by the current skin texture resolution and simplified face, garment and hair geometry.

Validation includes production session/component handlers, actual Workspace shot preparation, camera freeze/lock behavior, real male/female geometry across poses and proportions, cancellation, built-in tattoo source selection, and native Blender proofs of default and rotated shoulder tattoos using the production camera. Diagnostic tattoo raster proofs do not substitute for actual browser WebGL baking. Live browser automation remains unavailable because its admin policy security check could not be verified; these tests do not establish a clicked-through browser result.
