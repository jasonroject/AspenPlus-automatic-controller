# Validation — 2026-11-17

## Command aliases, collapsible inspector, clean screen and localization

- Added Enter/Space-executed CAD aliases, F1 help, F7 grid display, Ctrl+1 inspector, Ctrl+0 clean screen and Ctrl+9 command line. M now opens Move; DI starts measurement. Clean screen restores prior side-panel state. Chinese/English is persistent and presentation-only.
- Reproduced and fixed Esc arbitration in the transform panel: capture-phase cancellation now closes the active panel before global selection handling. Rapid REC entry retains all letters; command-field Ctrl+A does not select model objects. Repaired narrow English header clipping, untranslated material labels and overlapping toolbar labels.
- 60 Ego checks passed: layout 5, language 5, aliases 7, selection 9, 2D wheel 7, drafting/grip wheel 4, core grips 11, clean-screen workflow 6, final English layout/editing 4, final layout/restoration 2. Evidence: `../outputs/cad-workspace-i18n-20261117/checks-*.json`; zoom checks are under its `checks` property. Intermediate failed assertions remain for traceability; reload selects the first restored object by existing design, so final selection was explicitly cleared.
- 135 automated tests, TypeScript and production/standalone build passed. Nonblocking bundle-size warning remains. Native viewport plus 1366×850 and 390×844 desktop emulation were used; no mobile touch, native AutoCAD or direct file:// execution was claimed.
- Restored all 48 original objects and compared every shape field against the fresh pre-task backup. Final language Chinese, compact panels, left tree collapsed, right inspector available, sketch view and no selection. Served HTML exactly matches deliverable; SHA256 `58e12190b2fa161fb36cb3a267e43b989cf229741363376fe3b8c9d5bdb069b6`.
- Details and supported command boundaries: `deliverables/CAD_快捷键清屏与双语验证_20261117.md`. Earlier immediate-letter shortcuts and M-for-measure guidance are superseded.

## User correction: blank-click deselection and viewport wheel zoom

- The user found click-move-click selection sticky and clarified that only the surrounding interface should avoid wheel zoom. Removed the second-corner waiting state: a blank click clears ordinary selection; a held drag beyond 3 CSS px shows the white selection box; release completes it. Ctrl/Shift blank clicks preserve the selection, and drag addition/removal remain available.
- Restored cursor-centered wheel zoom on 2D and 3D canvases using non-passive native wheel listeners. The same percentage limits and controls apply. 3D uses camera zoom in both projections and anchors on the view plane through the orbit target. The global Ctrl/Meta-wheel page-zoom prevention remains; sidebars scroll normally. Wheel input during a held drag is ignored to avoid changing coordinates mid-gesture; continuous drawing and click-activated hot grips can zoom.
- Browser evidence: `../outputs/cad-wheel-click-20261117/`. Selection 9 checks, 2D wheel 7, drawing/hot-grip wheel 4, 3D wheel 6 passed. Covered blank deselection, 2px jitter, held white boxes, Ctrl/Shift, cancel, repeated zoom in/out, range limits, cursor anchors, continued drawing, linked grips and one-step undo.
- Native Ego viewport: 1695×798, DPR 1.5, visualViewport scale 1; sidebars 220/260 CSS px. Ordinary and Ctrl-wheel over canvases changed drawing scale, while page metrics and sidebars stayed fixed. Ctrl-wheel over the sidebar changed neither the drawing scale nor page metrics.
- A first unsnapped grip test assumed fractional synthetic pointer coordinates and integer wheel coordinates had the same anchor. Its 0.05634 mm X discrepancy was retained in `round-04.mjs` / `grip-wheel-failure.png`. The corrected test uses integer screen coordinates and compares the corresponding pre-zoom world coordinate; it passed at 1e-9 mm tolerance. No application rounding was added to hide this difference.
- 131 automated tests, TypeScript and standalone build passed. The existing nonblocking bundle-size warning remains. Earlier sections describing two-click selection or disabled canvas wheels are historical and superseded by this user correction.
- Two final checks on the restored 48-object project confirmed ordinary sidebar scrolling and Ctrl-wheel protection, bringing this pass to 28 browser checks. Every shape field exactly matches the fresh pre-task backup. Served HTML equals the delivery artifact, SHA256 `1ca591d08c9701071b3e3d97c9241547b66aec08441ad74e67e8eee1583f46f0`. The original sketch workspace is left open with no selection or test geometry.

## White selection windows and sketch selection workflow

- Two further Gemini discussions covered actual drafting sequences, click-move-click selection, modifier timing, keyboard arbitration and panning. Autodesk's object-selection instructions were checked; native AutoCAD was not run.
- Reproduced missing two-click selection before editing. Added click-move-click alongside drag selection, white solid containment / white dashed crossing outlines, faint neutral fill, compact cursor labels and proposed-selection highlighting. White is the user's color preference, not a claim about AutoCAD's default color.
- Unified Shift removal across 2D, 3D and the object tree; Ctrl single click toggles and Ctrl box selection adds. Modifier changes refresh the preview and the final event determines the operation. Kept ordinary replacement selection rather than adopting AutoCAD's default PICKADD=2 accumulation.
- Pending boxes preserve the previous selection until confirmation. Esc/right-click/Ctrl+Z cancel only the pending box; Delete/Backspace cannot delete previous selections; Enter/Space confirm the box. Second clicks on endpoints do not enter grips. Hidden-tab, view/tool/panel exits cancel cleanly. First corners remain world anchored through middle-button panning.
- 57 Ego browser checks passed: selection core 11, drafting workflow 11, modifiers/panning 8, edge cases/layout 6, 3D consistency 4, hot grip regression 11 and LINE continuation regression 6. The 390 px screenshot was inspected after hiding overlapping restore/selection banners. Test evidence, downloads, before-fix reproduction and Gemini replies: `../outputs/cad-selection-20261117/`.
- 128 automated tests and TypeScript passed. Standalone build passed with a nonblocking Vite bundle-size warning; the offline artifact intentionally embeds the application and Three.js. Details: `deliverables/CAD_白色框选与草图选择验证_20261117.md`.
- Restored the fresh 48-object user backup and compared every shape field exactly after reloading the final build. Served HTML equals the delivered artifact (SHA256 `0444a3d5e2f764df3883770c4585750a3989caed0609bdecd5fb329e13e73a69`). Ego was returned to the user with the restored sketch workspace open; test geometry was removed by restoring the original project.

## LINE continuation and hot grip editing

- Consulted Gemini in three further rounds and checked Autodesk LINE, grip and Direct Distance Entry documentation. Kept direct-distance direction tied to the cursor; explicit polar coordinates fix the direction. No native AutoCAD validation was claimed.
- Added surviving-last-LINE continuation, five hot grip modes for points/sketch lines, pure local previews, numeric readouts, midpoint grips, shared-node propagation, and one-transaction confirmation/undo. Legacy LINE continuation preserves elevation and does not silently relink old lines.
- Reproduced and fixed keyboard input lost after clicking drafting buttons, failure to exit hot grips via the already-active Select tool, and a background-timer visibility race. Returning to a visible tab now also checks elapsed hidden time. Corrected crossing-window color to green.
- 50 browser checks passed, including 60 shared lines / 121 objects at 5000% zoom, untouched far endpoints, hidden/locked neighbors, unselected-neighbor zero lengths, exact input preview, Space/Enter closed-outline workflows, redo preservation, file/modal/view/panel cancellation and 390 px layout. Core suites were repeated after the final changes. A 45-frame sample on this desktop had median 6.1 ms and maximum 8.6 ms; this is an observation, not a performance guarantee.
- 124 automated tests, TypeScript and standalone build passed. Evidence: `../outputs/cad-grips-20261117/`; details: `deliverables/CAD_续画与夹点编辑验证_20261117.md`. Failed attempts and before-fix evidence are retained; a decimal arithmetic assertion was corrected to a 1e-10 mm tolerance.
- Restored the fresh original 48-object project and verified exact equality of every shape field. Served HTML matched the final delivery artifact. Ego remains on the restored CAD sketch workspace; no test geometry remains.

## Point-line interaction regression

- Three actual Gemini discussion rounds covered high-risk cases, proposed fixes and final differences. Autodesk LINE, grip and constraint documentation was checked. No native AutoCAD session was run; Gemini's production-readiness opinion was not adopted as validation.
- Reproduced node dragging ignoring F3 (50,26 instead of the target 50.3,25.4), missing canvas feedback for locked neighbors, and a rejected-first-preview drag with no undo entry. Fixed all three and retained before/after downloads.
- Added graph-aware snap exclusion, point/grip F3 consistency, whole-line endpoint/midpoint alignment, drag F8/Shift refresh, affected-line preview, lock feedback and a 3 CSS-pixel editing threshold. Coincident hit testing keeps the selected node despite tiny floating-point differences. Dragging onto another point does not merge it.
- Passed browser checks for blind absolute/relative/polar/distance input, repeated commands, reuse/U/C/Esc, repeated endpoint clicks, point/grip/body snapping, multi-selection with no double move, atomic undo/redo, rejected→valid undo/redo, return-to-start preserving redo, 2px jitter, 5000% small drag/window selection, and coincident-node selection. Exact snap comparisons use 1e-10 mm tolerance; graph endpoints match referenced point fields.
- Actual tab switching to Gemini cancels the drag. Ego emits sub-millisecond transient visibility changes during normal actions, so visibility loss must persist 50 ms; ordinary window blur still cancels immediately. Immediate visibility cancellation was tested, found to break normal drags, and replaced.
- TypeScript, standalone build and 111 automated tests passed (two new graph/snap regression tests). Evidence: `../outputs/cad-interaction-20261117/`. Chinese details: `deliverables/CAD_点线交互回归与传统CAD差异_20261117.md`.
- Restored the user's fresh 48-object backup, reloaded the final build, downloaded it again and compared every shape field: exact equality. No test geometry remains. The served HTML matched the final delivery artifact.
- Reviewing the restored scene exposed a 2D Fit issue: centering on the vertex mean let densely tessellated shapes bias the view and clip distant lines. Fit now centers on the full visible bounding box.

## Fixed panels and explicit viewport zoom

- Disabled 2D wheel zoom and 3D OrbitControls zoom; Ctrl/Meta+wheel is prevented at the application window. Added independent +/-/percentage/100%/Fit bars to both viewports and a modal workspace Options module with persistent fixed panel widths.
- Ego native viewport 1695×798, DPR 1.5: Ctrl+wheel over canvas and sidebar preserved innerWidth, DPR, visualViewport scale, header height and sidebar widths. Ordinary wheel still scrolled the object list. Earlier emulated-viewport checks were supplemented with this native-window check.
- Tested 2D 5000% and 100000%, max button limit, minus, invalid input recovery, reset and fit. Tested 3D perspective 200%, orthographic 80/100/150%, reset, fit and wheel suppression. The first immediate input assertion ran before React's display effect; observable-state waits passed. No zoom-control code change was needed for that timing issue.
- Compact/standard/wide widths work; compact survives reload and standard was restored. Options blocks model deletion shortcuts. At 390×844 the page has no horizontal overflow and the dialog stays within the viewport. Floating overlays now sit below the zoom bar.
- TypeScript check, standalone production build and all 109 existing tests passed. Actual served HTML matched the final local artifact. Downloaded the user's project before and after this resumed pass: all fields of all 48 shapes were identical. No test geometry was introduced.
- Evidence: `../outputs/cad-zoom-20261117/`; usage: `deliverables/CAD_固定界面与缩放选项_20261117.md`. Desktop Ego only; no touch-device or direct file:// check. Browser menu/keyboard page zoom is still available.

## Point-line drawing and linked endpoints

- 109 tests, TypeScript and standalone build passed. Ego tested continuous point-line creation, existing-node reuse, atomic local undo, closed chains, shared-node movement, endpoint edits, cascade deletion and undo, independent copies, save/reload linkage, mouse drag undo and Escape rollback. 390 px desktop viewport has no page overflow.
- Actual DXF POINT/LINE export/reimport preserved geometry; ezdxf audit: 0 errors, 0 fixes. Native AutoCAD was not run. Linked relationships are stored in project JSON; DXF exchanges geometry only.
- Restored the original six-object project and compared all shape fields exactly. Served HTML matched the final artifact. Evidence: ../outputs/cad-drawing-20261117/. Chinese usage: deliverables/CAD_点线绘制与联动_20261117.md.

## CAD workflow expansion and geometry correction

- Consulted Gemini in Ego in four rounds: priorities, implementation boundaries, screenshot review, and Boolean acceptance cases. Rejected its unitless 1:1 import suggestion; source units are converted to mm.
- TypeScript, production/standalone build, and all 81 tests passed. Logs: `../outputs/cad-expansion-20261117/unit-tests.txt`, `typecheck.txt`, `build.txt`.
- Ego used the actual standalone HTML at localhost:5180. Created a 100 × 50 × 10 base and two Ø10 × 20 pins 60 mm apart. Shared-center 90° rotation, XYZ ×2 scaling, XYZ movement to (1000,1000,20), copy, undo and fit were verified.
- Measured the pin-center distance as 60.00 mm; zoom preserved the reading and history did not change. Reduced the completed measurement overlay to about 29.3 px high.
- Verified locked objects are excluded from mixed transforms/deletion; hidden selected objects are excluded from canvas dragging. Search, isolate/show-all, modal/input shortcut isolation, Ctrl+K and keyboard command execution passed.
- Drag tests cover a snapped-zero initial movement, fast release, release outside the canvas, Ctrl+Z blocked during an active gesture, Escape restoring past/present/future, and returning to the original position without losing redo.
- Inspected 1000, 768 and 390 px widths. Creation and DXF dialogs fit; the narrow toolbar scrolls horizontally. These were desktop viewport checks, not touch-device validation.
- Verified exact parameter retention across creation-panel reopen and primitive-type switch. Downloaded project JSON remained identical after focusing/blurring precise numeric fields. Moving/resizing a 1.234567 mm profile retained all unedited Y and Z values.
- Actual DXF input: 2 × 1 in became 50.8 × 25.4 mm, elevation 6.35 mm and thickness 12.7 mm. Unitless/broken files were blocked appropriately. Partial-import confirmation now names the skip and import counts and is one undoable append.
- Actual six-object DXF export→import preserved every outer/hole point, Z height and elevation. ezdxf 1.4.5 readfile and audit reported 0 errors, 0 fixes; file remained unchanged.
- Replaced Boolean perturbation/rounding with polygon-clipping 0.15.7. Verified empty A−B, split results, a second hole, and tangent holes are refused without scene mutation. Tool B holes participate correctly. UI preview→confirm retains source objects hidden; one undo restores them. Result Z comes from A, with this XY-only rule shown in the panel.
- Downloaded the actual Boolean-ring STL: 576 triangles, 864 unique edges, zero edges with an incidence count other than two. Signed volume 3137.6081662 mm³ versus profile expectation 3137.6067389 mm³ (relative difference 4.55e-7).
- Startup debugging found duplicate mesh construction and shader compilation before the shapes effect rebuilt the same meshes. Removing the redundant initialization eliminated the reproducible WebGL warnings; a fresh reload after Log.clear recorded 0 warnings/errors and no runtime exceptions.
- Restored the user's original six-object project through the file UI. Downloaded it again and compared all shape fields after canonicalizing key order: exact equality. No test objects remain in the final workspace.
- Evidence, reproducible scripts, fixtures, original project backup and source backup are in `../outputs/cad-expansion-20261117/`. Direct file:// launch and native AutoCAD import were not tested; all application assets and required geometry code are embedded in the delivered HTML.

## Ego interaction revision

- Consulted Gemini in Ego for interaction review. Kept the existing charcoal visual system; implemented concrete selection, preview, input and panel improvements.
- Reproduced before editing: Ctrl-click on the 3D sleeve replaced the selected base; Boolean preview remained in `3d-only` while its result existed only in the hidden 2D canvas.
- Verified in Ego: Ctrl/Shift add/toggle selection, modifier-click on blank preserves selection, ordinary blank clears it, all selected objects highlight, and orbit dragging does not change selection.
- Boolean preview now opens the 2D canvas and collapses the command panel. Preview does not change the six-object scene. Editing the base width from 112 to 120 invalidated the preview; applying a fresh preview produced seven objects with two hidden operands, and one undo restored six visible originals.
- Bottom numeric fields accept an empty draft without changing geometry. Committing width 125 and undoing once restored 112. A mixed-height selection (8 and 32) was unified to 8 by entering the first object's existing value; one undo restored the sleeve to 32.
- Found and repaired the 800 ms autosave debounce gap on page exit. Immediate reload after setting width 120 retained 120. Restored the final model to width 112.
- Reviewed 1366 × 768 and 1130 × 650 layouts. At 1130 px the Boolean panel was 660 px inside a 700 px canvas. At 1000 px it shrank to 546 px inside a 570 px canvas, without horizontal overflow.
- Downloaded and parsed the actual project JSON (six objects, base width 112 mm) and STL (3,456 vertices; bounds X [-56, 56], Y [-42, 42], Z [0, 40] mm).
- TypeScript check and production/standalone build passed. All 21 existing geometry, serialization and storage tests passed. Final artifact is `deliverables/ExtrudeCAD_Studio.html`.
- Browser evidence and checks: `../outputs/ego-cad-20261117/`. Testing used the exact standalone artifact served over localhost in Ego; direct `file://` opening and mobile editing were not tested in this pass.

## Charcoal theme revision

- Applied neutral charcoal surfaces across shell, inspector, tool drawers, dialogs, 2D and 3D viewports. Blue remains the selection accent; original model color data is preserved.
- Browser-reviewed the 3D workspace, 2D dimensions/grid and export dialog. Engineering-sheet preview stays on light paper and restores the dark scene after rendering.
- TypeScript check passed; final browser console showed no warnings or errors. Geometry and editing logic were not changed.

## Precision Light revision

- Consulted Gemini in three rounds: design hierarchy, technical boundaries, and acceptance criteria. Retained explicit user control over custom colors and split views.
- Rebuilt the shell with a 48 px graphite header, 220 px object tree, 260 px inspector and contextual floating tools. Fixed grid min-content overflow that pushed the header outside the viewport.
- Tested Chrome at 1366 × 768 and the original desktop viewport. Verified 2D, 3D, split layouts and the compact camera selector for narrow panes.
- Changed base width from 112 to 120 mm in the inspector. The 2D label and export summary updated. Downloaded the actual STL and parsed 3,456 vertices: bounds X [-60,60], Y [-42,42], Z [0,40] mm. Undo/redo/undo restored 112 mm.
- Verified engineering-sheet preview rendered with all standard views; browser error/warning log was empty after the final checks.
- Added true orthographic cameras for isometric and standard engineering views, with correct camera/control rebinding and fit padding for the floating tools.
- Smooth preview normals preserve 30-degree creases. Actual STL/OBJ topology is unchanged. Demo is six independent solids with two aligned real through-holes; it does not imply assembly constraints or bolt mounting holes.
- Re-ran all 21 geometry/serialization/storage tests successfully; final TypeScript check passed.

## Initial implementation validation

- TypeScript type check passed.
- 21 automated geometry, serialization and storage tests passed. Regression coverage includes watertight hollow STL/OBJ, bevel geometry, Z offsets, SVG bounds, empty projects, corrupt imports and unavailable local storage.
- Chrome desktop: loaded the redesigned workbench; added a cylinder; changed extrusion height from 30 to 45 mm and confirmed volume/height display changed.
- Drew a rectangle by dragging on the actual 2D canvas; confirmed a sixth shape and corresponding dimensions appeared.
- Undo removed the new shape and redo restored it.
- Saved the six-shape project; verified a 6,910-byte `.extrudecad.json` download on disk.
- STL export showed success feedback; engineering-sheet tab rendered its multi-view preview.
- Built `deliverables/ExtrudeCAD_Studio.html` (about 1 MB), with JavaScript/CSS/Three.js embedded and no remote fonts or application assets. Served this exact artifact over localhost and confirmed both 2D and 3D workspaces rendered.
- Direct `file://` navigation could not be tested through the browser automation interface because its URL policy allows only HTTP(S). No browser security settings were changed. The HTML has no external application asset requests and is intended for local opening.

The inherited editor remains a 2D-profile/Z-extrusion tool, not an unrestricted solid-modeling kernel. Mobile CSS is provided; this pass verified desktop browser interactions.
