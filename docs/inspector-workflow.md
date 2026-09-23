# Inspector workflow

The inspector opens on Tattoo, with separate Figure and Studio tabs. Panels stay mounted while hidden, retaining their scroll positions and expanded sections for the current scene. Arrow keys, Home and End navigate the tabs.

## Tattoo

Artwork, image replacement, the built-in example, placement guidance, before/after visibility and all tattoo adjustments are together. Size and opacity use percentages; rotation uses degrees. Exact values can be typed without changing the scene on every partial keystroke: Enter or blur commits, Escape cancels. Each adjustment has a separate reset button. Replacing artwork keeps its placement.

## Figure

Choose the model, skin, shape presets, pose and appearance. Detailed proportions, limb adjustments and clothing/hair settings can expand when needed. Their summaries show the active choices. Numeric fields use the same editing and reset behavior as tattoo and lighting controls.

## Studio

Backdrop and lighting have one home. Lighting has one preset selector; individual edits show Custom. Presets, light-map dragging, individual light controls, colors, enable switches and reset are retained. Simple backgrounds are available alongside studio paper; gradient backgrounds retain the existing Blender first-color limitation.

## Viewport

View, Focus, Fit, Clean view and preview settings sit beside the canvas. A focused region shows a persistent Return to full figure action and explains hidden clothes/body parts. Clean view hides editing panels and guides. Faster preview changes only the interactive preview, not Blender output quality. Snapshot remains in the main toolbar and uses the unchanged canvas rectangle for image/live comparison.

## Undo and Redo

Toolbar buttons and Cmd/Ctrl Z, Cmd/Ctrl Shift Z or Ctrl Y restore up to 60 edits in the current scene. History includes placement, artwork, tattoo adjustments, figure/model, shape, pose, outfit, hair, backdrop and lights. One continuous pointer drag or held slider key is one operation. Camera navigation, Focus and panel selection do not create edit history. Native text-field undo stays with the field; use the toolbar to undo a scene edit after typing. Undo/Redo are unavailable while a rendering/setup dialog owns the workspace, but Snapshot light gestures still group correctly. History resets when leaving or changing scenes and is not saved across reloads.

Restored placements update the actual mesh, including undoing the first tattoo placement back to empty skin. Prior uploaded image strings are shared between entries rather than duplicated.

## Validation

Production component and handler tests cover tabs, remembered panel state/scroll, exact values, resets, viewport choices, complete edit history, gesture boundaries, native text undo, scene isolation and mesh placement replay. Existing placement, shape, pose, appearance, studio, Snapshot, save and export regressions are included in test:demo. Type checking, lint and production build are checked separately.

Live visual inspection remains unverified: browser access was denied because the admin-enforced security policy could not be verified. Source/CSS and component tests are not a substitute for viewing the live layout.
