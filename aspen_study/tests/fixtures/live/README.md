Real `aspen-probe/1` outputs from Roice's Windows PC (Aspen Plus V15, Apwn.Document.41.0), 2026-11-19, copied verbatim
from the box (`/workspace/aspen-probe/`). Not synthetic: tests drive fake COM trees from these numbers.

| file | model | what it is |
|---|---|---|
| `live_hr_summary.json` | heatrecovery.bkp (MET) | `probe-summary.json`: state `warning` (COOLER/VALVE phase stability, REACTOR zeroed rates; BLKSTAT 2), UOSSTAT2=10 |
| `live_hr_graph.json` | heatrecovery.bkp | `graph.json` (aspen-model-graph/1) from the same run |
| `live_mch_summary.json` | mch.bkp (Aspen example RadFrac, MET set, native Btu/hr duties) | `probe-summary.json`: state `ok`, UOSSTAT2=8 |

Note `live_hr_summary.json` `study.error` holds a real Windows temp path (`C:\Users\Administrator\AppData\Local\Temp\...`):
the node bridge was missing in that staging directory; it does not affect the probe numbers.
