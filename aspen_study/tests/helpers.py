from pathlib import Path
import json
import shutil

FIXTURES = Path(__file__).resolve().with_name("fixtures")
HAS_NODE = shutil.which("node") is not None


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def user_library(entries):
    """Arithmetic test factors (NOT environmental data)."""
    return {"schema": "aspen-factor-library/1", "version": "test-fixture", "entries": [
        {"id": i, "match": m, "category": "GWP100", "value": v, "low": None, "high": None,
         "denominator_unit": d, "impact_unit": "kg CO2-eq", "method": "IPCC 2021 GWP100",
         "source": "unit-test arithmetic fixture, not environmental data", "year": 2026, "status": "user_supplied"}
        for i, m, v, d in entries]}
