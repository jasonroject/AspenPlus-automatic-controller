# English UI review — Inter, 2026-11-17

Preview: http://127.0.0.1:8766/index.en.html

Browser: Ego Lite, existing HTL Studio task Space. Desktop actions were performed through the browser. Responsive layout inspection covered 1440, 1130 and 390 CSS px widths; table content intentionally scrolls inside its own region.

| Module | Actual checks | Result |
| --- | --- | --- |
| Overview | STD matrix selection T350-L15, refresh, energy-inventory dialog | Selected condition and page restored; dialog readable |
| Case Data | T330-L10 search, HR filter, mismatched temperature, reset, View | 2 paired records; 1 HR record; clear empty result; correct case opened |
| Process & Equipment | All 7 equipment selections, 3D pump label, top/overview/focus/zoom, keyboard camera and tabs, expanded results | Selection, label, highlight and parameter panel stay aligned |
| Life Cycle Assessment | T340-L15 STD then HR, formula and interval display | CF changes from 15.601 to 10.878; calculation labels now 15 px |
| Case Screening | Four presets, custom slider key, all-zero weights, recommendation button, point tooltip | Winners and scores update; zero-weight guidance appears; recommendation opens correct case; tooltip stays inside chart |
| Data Sources | Four provenance cards and stored/display units | Legible text, hashes wrap and units remain visible |

Inter was verified through the browser's rendered-font information: Inter Variable / InterVariable-Display-Bold, loaded from the project's WOFF2. Font file provenance and license are in analysis_web/vendor/fonts/.

Found and corrected: small 9–13 px secondary states, hard-coded Times in the canvas, long navigation labels, equipment value/unit wrapping, 3D label collisions, formula wrapping, selected-row color override, tooltip sizing/color, and mobile matrix heading/check-mark crowding. The initial layout JSON records the issues before the final targeted fixes; follow-up checks confirmed the equipment panel title is 14 px and the mobile matrix header no longer overflows. Screen-reader-only table captions were excluded from visible-type conclusions.

Export evidence: inter-T330-L10-HR.json. Its case object exactly matches the corresponding archived study.json record. app.en.js and plant-view.js passed node --check. No source dataset or ranking formula was changed.

Screenshots: inter-overview.png, inter-cases.png, inter-process.png, inter-lca.png, inter-screening.png, inter-sources.png and inter-mobile-*.png. Screenshots capture representative states, not every interaction. Desktop operation plus emulated mobile layout inspection does not constitute full testing on a physical mobile device.
