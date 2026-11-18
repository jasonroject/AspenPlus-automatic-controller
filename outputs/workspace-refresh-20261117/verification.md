# Workspace redesign verification

Commit d24e24a719ec6df7648aad0f62d03983f70ebbbb is pushed to main.
Vercel dpl_34xJJhZagZCNMD1ZadZFab1GgmXC is READY; public URL https://vercel-pi-ten-59.vercel.app/universal.html was tested in Ego without authentication.

- 21 Node tests passed: 12 calculation-core tests, 3 existing documentation/example tests and 6 new preflight/result-state tests.
- Ego exercised empty workspace, guided example, calculation, case ranking and JSON export. Case A stays at 5 kWh/kg, 3 illustrative kg CO2-eq/kg and 20% yield. B remains nominal first, with both rank supports 1–2.
- Editing the basis hides and clears prior results and disables result export. Pending JSON blocks removal/editing of rows, saving and advancing; discard retains the last applied project.
- Missing climate factor fixture shows Unavailable for that headline, disables climate ranking and reports the factor ID. Complete acidification category remains eligible.
- Imported all five worksheets from generic-import.xlsx using Apply and Next worksheet. Counts: 4 streams, 2 blocks, 2 cases, 4 inventory rows, 4 factors. After declaring the basis, the calculated summary matches the JSON example.
- HTL fixture: numeric closure, purchased energy 2.231 kWh/kg, declared-boundary climate 11.069 kg CO2-eq/kg, target/feed yield 5.501%. Single-case comparison explains the need for another eligible case. No new native Aspen run was performed.
- Desktop 1440px and narrow 390px layouts inspected. No page-wide overflow; detailed energy SVG/table scrolling remains inside its own containers. Screenshots stored beside this report.
- Prediction data loaded without error; archived process page renders its 3D canvas after shared visual refinements.
- Production example calculation repeated after deployment; final empty import page left open in Ego Space 2.

Ego auto-scroll occasionally timed out on offscreen controls. Current page state was inspected before keyboard focus/Enter activation; the same controls performed their intended actions. No calculation-core or research-data files changed.
