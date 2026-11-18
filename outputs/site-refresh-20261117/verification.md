# Process Studio design and documentation verification

2026-11-17. Commit: 3aaa327abe704a5d79ab3d78f593afc2629ff923; remote main matches.
Production: https://vercel-pi-ten-59.vercel.app/
Deployment: dpl_8s57VZ9ufW7Y1eN4UjV572Zrrtbs (READY).

- 24 individually generated logo originals and exact prompts in analysis_web/assets/brand; all PNG signatures checked, all visually inspected in Ego gallery. Concept 01 is the site identity.
- 13 documentation articles; 38 local asset/document links checked.
- 12 core checks and 3 documentation/demo checks passed. Copied browser snippet executed against the actual core module and fixture.
- Ego 1440px desktop and 390px narrow layouts inspected; no page-wide overflow on home, docs contract or brand preview. Tables scroll inside their containers.
- Home motion pause and system reduced-motion inspected. Runnable synthetic example returned A energy 5 kWh/kg, climate 3 kg CO2-eq/kg and alpha-zero support [2.091, 4.222]; B/A nominal order, both possible ranks 1–2.
- Docs search, title relevance, keyboard selection, mobile navigation, copied-code feedback, article navigation and section link checked. Fixed search relevance and disabled search/menu until module initialization.
- Logo selection and original download checked; downloaded concept 07 SHA-256 equals the original. Concept 24 selected via keyboard on narrow screen.
- Original universal example calculates successfully. HTL prediction shows 121 archived native samples and 3/3 fresh verifications. 3D research workspace still renders. Legacy root #view URL retains parameters and routes to workspace.zh.html.
- Corrected low-contrast navigation text when switching existing sidebars to white.
- Live production home, docs quickstart calculation, search and 24-logo gallery verified without a sign-in page. Final homepage left open in the existing Ego task Space 2.

Browser action caveats: two stale/ambiguous test selectors were corrected; deep offscreen logo selection used keyboard focus/Enter after Ego click auto-scroll failed. One section-link assertion used an unnecessarily strict top-position threshold; inspection confirmed the target heading was visible at 218px. These do not indicate calculation failures.

No scientific-core or research-data changes. Synthetic example factors remain illustrative. No fresh Aspen solver run was performed for this visual/documentation change.
