import json, sys
from pathlib import Path
base = Path(__file__).resolve().parent
sys.path.insert(0, str(base.parent / 'cad-expansion-20261117' / 'python-vendor'))
import ezdxf
doc = ezdxf.readfile(base / 'browser-reference.dxf')
entities = list(doc.modelspace())
audit = doc.audit()
assert [e.dxftype() for e in entities] == ['POINT', 'POINT', 'LINE']
assert tuple(entities[0].dxf.location) == (1.23456789, 2.3456789, 0)
assert tuple(entities[1].dxf.location) == (40, 30, 0)
assert tuple(entities[2].dxf.start) == (0, 0, 0)
assert tuple(entities[2].dxf.end) == (40, 30, 0)
assert len(audit.errors) == len(audit.fixes) == 0
result = dict(reader='ezdxf '+ezdxf.__version__, entities=[e.dxftype() for e in entities], errors=0, fixes=0, coordinatesExact=True, units=doc.units)
(base / 'browser-reference-ezdxf-audit.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(result)
