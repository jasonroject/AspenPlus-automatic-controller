"""不依赖 Aspen 的假 COM 对象：按路径表模拟 Tree.FindNode / Elements / AttributeValue / Engine。

数值取自 2026-11-19 真机 heatrecovery.bkp 与 mch.bkp 的读数（MET：cal/sec；ENG：Btu/hr）。
"""
from __future__ import annotations


class FakeComError(Exception):
    def __init__(self, hresult, text="com error"):
        super().__init__(text)
        self.hresult = hresult


class Items:
    def __init__(self, nodes):
        self._n = nodes

    @property
    def Count(self):
        return len(self._n)

    def Item(self, i):
        return self._n[i]


class FakeNode:
    def __init__(self, name, value=None, unit="", dim=0, kids=None, attr6=None):
        self.Name, self.Value, self.UnitString, self.Dimension = name, value, unit, dim
        self._kids, self._attr6 = kids, attr6

    @property
    def Elements(self):
        if self._kids is None:
            raise FakeComError(-2147352567, "Exception occurred.")  # 真机：标量节点访问 Elements 会抛错
        return Items(self._kids)

    def AttributeValue(self, i):
        if i == 6 and self._attr6 is not None:
            return self._attr6
        raise FakeComError(-2147352567)


class FakeTree:
    def __init__(self, table):
        self.table = table
        self.lost = False

    def FindNode(self, path):
        if self.lost:
            raise FakeComError(-2147023174, "RPC server unavailable")
        return self.table.get(path)


class FakeEngine:
    def __init__(self, polls=2, hang=False, fail_run=None):
        self.polls, self.hang, self.fail_run = polls, hang, fail_run
        self.calls, self._left, self.stopped = [], 0, False

    def Reinit(self):
        self.calls.append("Reinit")

    def Run2(self, *a):
        self.calls.append(("Run2",) + a)
        if self.fail_run:
            raise self.fail_run
        self._left = self.polls

    @property
    def IsRunning(self):
        if self.hang and not self.stopped:
            return True
        self._left = max(0, self._left - 1)
        return self._left > 0

    def Stop(self):
        self.calls.append("Stop")
        self.stopped = True


class FakeDoc:
    def __init__(self, table, engine=None, pid=4242):
        self.Tree, self.Engine, self.ProcessId = FakeTree(table), engine or FakeEngine(), pid
        self.SuppressDialogs, self.Visible, self.closed, self.opened = 0, 1, None, None

    def InitFromArchive2(self, path):
        import os
        assert os.path.isfile(path), path
        self.opened = path

    def InitFromFile2(self, path):
        import os
        assert os.path.isfile(path), path
        self.opened = path
        self.opened_with = "InitFromFile2"

    def Close(self, save):
        self.closed = save


class FakeProcessOps:
    """snapshot -> {pid: (ppid, image)}；kill 只记录。"""

    def __init__(self, table):
        self.table, self.killed = dict(table), []

    def snapshot(self):
        return dict(self.table)

    def kill(self, pid):
        self.killed.append(pid)
        self.table.pop(pid, None)


def build_table(spec):
    """spec: {path: dict(value=, unit=, dim=, kids=[names], attr6=)} -> {path: FakeNode}，自动建立 kids 的子节点。"""
    table = {}
    for path, d in spec.items():
        d = dict(d)
        name = path.rsplit("\\", 1)[-1]
        table[path] = FakeNode(name, d.get("value"), d.get("unit", ""), d.get("dim", 0), None, d.get("attr6"))
    for path, d in spec.items():
        if d.get("kids") is not None:
            kids = []
            for k in d["kids"]:
                child = table.get(path + "\\" + k)
                if child is None:
                    child = FakeNode(k)
                    table[path + "\\" + k] = child
                kids.append(child)
            table[path]._kids = kids
    return table


def heatrecovery_spec():
    S = r"\Data\Results Summary\Run-Status\Output"
    spec = {
        S + r"\VERNO": dict(value="41.0"),
        S + r"\UOSSTAT2": dict(value=10),
        S + r"\PER_ERROR": dict(value=1, dim=1, kids=["1", "2", "3", "4"]),
        S + r"\PER_ERROR\1": dict(value="The following Unit Operation blocks were"),
        S + r"\PER_ERROR\2": dict(value="completed with warnings:"),
        S + r"\PER_ERROR\3": dict(value=" COOLER  REACTOR  VALVE "),
        S + r"\PER_ERROR\4": dict(value=""),
        r"\Data\Setup\Global\Input\INSET": dict(value="MET"),
        r"\Data\Setup\Global\Input\OUTSET": dict(value="MET"),
        r"\Data\Blocks": dict(kids=["B6", "COOLER", "HEATCHAG", "HEATER", "PUMP", "REACTOR", "VALVE"]),
        r"\Data\Streams": dict(kids=["FEED", "S2", "S3"]),
        r"\Data\Components\Specifications\Input\TYPE": dict(kids=["H2O", "STYRENE"]),
        r"\Data\Components\Specifications\Input\ANAME\H2O": dict(value="H2O"),
        r"\Data\Components\Specifications\Input\ANAME\STYRENE": dict(value="C8H8"),
        r"\Data\Components\Specifications\Input\CASN\STYRENE": dict(value="100-42-5"),
        r"\Data\Components\Specifications\Input\TYPE\H2O": dict(value="CONV"),
        r"\Data\Components\Specifications\Input\TYPE\STYRENE": dict(value="CONV"),
    }
    models = {"B6": "Flash2", "COOLER": "Heater", "HEATCHAG": "HeatX", "HEATER": "Heater", "PUMP": "Pump",
              "REACTOR": "RPlug", "VALVE": "Valve"}
    ports = {"B6": {"F(IN)": ["S3"], "L(OUT)": ["S7"]}, "PUMP": {"F(IN)": ["FEED"], "P(OUT)": ["S2"]},
             "HEATER": {"F(IN)": ["S2"], "P(OUT)": ["S3"]}, "COOLER": {}, "HEATCHAG": {}, "REACTOR": {}, "VALVE": {}}
    for b, m in models.items():
        base = rf"\Data\Blocks\{b}"
        spec[base] = dict(attr6=m)
        spec[base + r"\Ports"] = dict(kids=list(ports[b]))
        for port, streams in ports[b].items():
            spec[base + rf"\Ports\{port}"] = dict(kids=streams)
    out = lambda b, n: rf"\Data\Blocks\{b}\Output\{n}"
    spec[out("B6", "BLKSTAT")] = dict(value=0)
    spec[out("B6", "QCALC")] = dict(value=192.82363, unit="cal/sec")
    spec[out("B6", "B_TEMP")] = dict(value=313.0, unit="K")
    for b in ("COOLER", "VALVE"):
        spec[out(b, "BLKSTAT")] = dict(value=2)
        spec[out(b, "BLKMSG")] = dict(value="PROBLEM(S) ENCOUNTERED DURING PHASE STABILITY CHECK")
        spec[out(b, "PER_ERROR")] = dict(value=1, dim=1, kids=["1", "2"])
        spec[out(b, "PER_ERROR") + r"\1"] = dict(value="*  WARNING")
        spec[out(b, "PER_ERROR") + r"\2"] = dict(value="   STABILITY CHECK FOR LIQUID PHASE: ...")
    spec[out("COOLER", "QCALC")] = dict(value=-2087.51163, unit="cal/sec")
    spec[out("COOLER", "B_TEMP")] = dict(value=313.0, unit="K")
    spec[out("HEATER", "BLKSTAT")] = dict(value=0)
    spec[out("HEATER", "QCALC")] = dict(value=1000.52531, unit="cal/sec")
    spec[out("HEATER", "B_TEMP")] = dict(value=603.0, unit="K")
    spec[out("HEATCHAG", "BLKSTAT")] = dict(value=0)
    spec[out("HEATCHAG", "HX_DUTY")] = dict(value=9673.5897, unit="cal/sec")
    spec[out("HEATCHAG", "DUTY_HOT")] = dict(value=1, unit="cal/sec", dim=1)  # 向量占位，必须被忽略
    spec[out("PUMP", "BLKSTAT")] = dict(value=0)
    spec[out("PUMP", "ELEC_POWER")] = dict(value=2.1717208, unit="kW")
    spec[out("PUMP", "BRAKE_POWER")] = dict(value=2.1717208, unit="kW")
    spec[out("PUMP", "WNET")] = dict(value=2.1717208, unit="kW")
    spec[out("REACTOR", "BLKSTAT")] = dict(value=2)
    spec[out("REACTOR", "BLKMSG")] = dict(value="REACTION RATE IS SET TO ZERO FOR SOME REACTIONS")
    spec[out("REACTOR", "QCALC")] = dict(value=2891.5462, unit="cal/sec")
    spec[out("REACTOR", "B_TEMP")] = dict(value=1, unit="K", dim=1, kids=["MIXED"])          # 真机：Value 恒为占位 1
    spec[out("REACTOR", "B_TEMP") + r"\MIXED"] = dict(value=1, unit="K", dim=1, kids=["1", "2", "3"])
    for i, v in enumerate((603.0, 603.0, 601.5), 1):
        spec[out("REACTOR", "B_TEMP") + rf"\MIXED\{i}"] = dict(value=v, unit="K")
    spec[out("VALVE", "BLKSTAT")] = dict(value=2)
    spec[out("REACTOR", "PER_ERROR")] = dict(value=1, dim=1, kids=["1", "2"])
    spec[out("REACTOR", "PER_ERROR") + r"\1"] = dict(value="*  WARNING")
    spec[out("REACTOR", "PER_ERROR") + r"\2"] = dict(value="   REACTION RATE IS GREATER THAN ZERO FOR REACTION (29) BUT")
    for sid, (t, p, m) in {"FEED": (298.15, 1.0, 100.0), "S2": (318.98, 246.73, 100.0), "S3": (603.0, 246.73, 100.0)}.items():
        o = rf"\Data\Streams\{sid}\Output"
        spec[rf"\Data\Streams\{sid}"] = dict(attr6="MATERIAL")
        spec[o + r"\TEMP_OUT\MIXED"] = dict(value=t, unit="K")
        spec[o + r"\PRES_OUT\MIXED"] = dict(value=p, unit="atm")
        spec[o + r"\MASSFLMX\MIXED"] = dict(value=m, unit="kg/hr")
        spec[o + r"\MASSFLMX"] = dict(dim=1, kids=["MIXED"])
        spec[o + r"\HMX_MASS\MIXED"] = dict(value=-2938.079, unit="cal/gm")
        spec[o + r"\HMX_FLOW\MIXED"] = dict(value=-81613.3056, unit="cal/sec")
        spec[o + r"\MASSFLOW"] = dict(kids=["MIXED"])
        spec[o + r"\MASSFLOW\MIXED"] = dict(dim=1, kids=["H2O", "STYRENE"])
        spec[o + r"\MASSFLOW\MIXED\H2O"] = dict(value=m * 0.9, unit="kg/hr")
        spec[o + r"\MASSFLOW\MIXED\STYRENE"] = dict(value=m * 0.1, unit="kg/hr")
    return spec


def radfrac_spec(cond=-5.0e5, reb=7.5e5, unit="Btu/hr"):
    S = r"\Data\Results Summary\Run-Status\Output"
    spec = {S + r"\VERNO": dict(value="41.0"), S + r"\UOSSTAT2": dict(value=8),
            S + r"\PER_ERROR": dict(value=1, dim=1, kids=[]),
            r"\Data\Setup\Global\Input\INSET": dict(value="ENG"), r"\Data\Setup\Global\Input\OUTSET": dict(value="ENG"),
            r"\Data\Blocks": dict(kids=["B1"]), r"\Data\Streams": dict(kids=[]),
            r"\Data\Components\Specifications\Input\TYPE": dict(kids=[]),
            r"\Data\Blocks\B1": dict(attr6="RadFrac"),
            r"\Data\Blocks\B1\Ports": dict(kids=["F(IN)", "LD(OUT)", "B(OUT)"]),
            r"\Data\Blocks\B1\Ports\F(IN)": dict(kids=["1", "2"]),
            r"\Data\Blocks\B1\Ports\LD(OUT)": dict(kids=["3"]),
            r"\Data\Blocks\B1\Ports\B(OUT)": dict(kids=["4"]),
            r"\Data\Blocks\B1\Output\BLKSTAT": dict(value=0)}
    if cond is not None:
        spec[r"\Data\Blocks\B1\Output\COND_DUTY"] = dict(value=cond, unit=unit)
    if reb is not None:
        spec[r"\Data\Blocks\B1\Output\REB_DUTY"] = dict(value=reb, unit=unit)
    return spec
