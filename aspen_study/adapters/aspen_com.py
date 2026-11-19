"""Aspen Plus COM 适配器（真机验证过的版本）。

验证记录（2026-11-19，Aspen Plus V15 / Apwn.Document.41.0，Python 3.14 + pywin32）：
  heatrecovery.bkp（Heater/HeatX/Flash2/Pump/RPlug/Valve，MET 单位集，运行有警告）
  mch.bkp（Aspen 自带示例，RadFrac，ENG 单位集，运行无警告）
节点规则与证据见 aspen_rules.py。设计要点：
  * 只在复制出来的临时副本上开"私有文档"，源文件不改（open 前后哈希对比）；
  * 运行前 Engine.Reinit()，保证读到的是本次计算而不是归档里的旧结果；
  * Engine.Run2(1) 异步启动 + 轮询，超时先 Stop，仍不退出就只结束本次启动的 Aspen 进程；
  * 缺失值一律 None，绝不补 0；向量节点（Dimension>0，Value 恒为占位符 1）不当标量读；
  * 单位永远读节点自己的 UnitString，不假设 kW。
"""
from __future__ import annotations

import hashlib
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path

from . import aspen_rules as R
from .aspen_process import WindowsProcessOps, aspen_pids, kill_ours, started_by_us
from .base import Reading, RunStatus, SimulatorAdapter
from .errors import (AspenConnectionLost, AspenError, AspenTimeout, AspenUnavailable, ModelOpenError)

STATUS_BRANCH = r"\Data\Results Summary\Run-Status\Output"
UOSSTAT2 = STATUS_BRANCH + r"\UOSSTAT2"
RUN_PER_ERROR = STATUS_BRANCH + r"\PER_ERROR"
BLOCK_OUT = r"\Data\Blocks\{b}\Output"
# 已在真机核对的流股节点（MET 与 ENG 单位集，MIXED 子流股）
STREAM_NODES = {"mass_flow": ("MASSFLMX", "mass_unit"), "h_mass": ("HMX_MASS", "h_unit"),
                "enthalpy_flow": ("HMX_FLOW", "energy_unit"), "T": ("TEMP_OUT", "T_unit"), "P": ("PRES_OUT", "P_unit")}
# COM 服务器消失时的 HRESULT：RPC 服务器不可用 / 已断开 / 调用被拒绝
_LOST_HRESULTS = {-2147023174, -2147023170, -2147417848, -2147417836, -2147023173}
# 真机验证（2026-11-19）：.bkp 用 InitFromArchive2；.apw（ethanol_flash.apw 的临时副本）用 InitFromFile2 能打开、运行并读取。
# 注意：只复制单个文件，依赖同目录其他文件（外部引用）的 .apw 可能打不开，会给出中文提示。
# .apwz 没有验证，默认拒绝；验证后可用 verified_open_methods={".apwz": "..."} 启用。
SUPPORTED_SUFFIXES = {".bkp": "InitFromArchive2", ".apw": "InitFromFile2"}
OPEN_HINTS = {".apwz": "未验证"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class AspenPlusCOMAdapter(SimulatorAdapter):
    name = "aspen-plus-com"

    def __init__(self, calorie_J=4.1868, timeout_s=1200, doc_factory=None, process_ops=None, poll_s=0.25,
                 workdir=None, keep_workdir=False, grace_s=15, verified_open_methods=None):
        # calorie_J：Aspen 自己的 cal 定义。真机把同一结果在 MET(cal/sec) 与 SI(Watt) 下各读一次：
        # HMX_FLOW -81613.3056 cal/sec = -341698.588 W，比值 4.18680000，即 1 cal = 4.1868 J。
        self.calorie_J = calorie_J
        self.timeout_s = timeout_s
        self.poll_s = poll_s
        self.grace_s = grace_s
        self.keep_workdir = keep_workdir
        self._doc_factory = doc_factory
        self._ops = process_ops or WindowsProcessOps()
        self._workdir_arg = workdir
        self._methods = dict(SUPPORTED_SUFFIXES)
        for suffix, method in (verified_open_methods or {}).items():
            self._methods[suffix] = method
        self._doc = None
        self._tree = None
        self._pid = None
        self._baseline = set()
        self._com_inited = False
        self._work = None
        self._copy = None
        self._model = {}
        self._finished = False
        self._run_error = None
        self._run_secs = None
        self._killed = []
        self._reads = 0
        self._report = None
        self._graph_parts = {}
        self._unverified = set()
        self._missing = []
        self._unmatched = set()
        self._watchdog = None
        self.source_unchanged = None
        self._source = None
        self._source_sha = None

    # ------------------------------------------------------------------ 打开
    def open(self, path):
        path = Path(path)
        if not path.is_file():
            raise ModelOpenError(f"找不到模型文件：{path}")
        suffix = path.suffix.lower()
        if suffix not in self._methods:
            hint = "；请先在 Aspen 里“另存为”.bkp（Aspen Plus Backup）再试" if suffix in OPEN_HINTS else ""
            raise ModelOpenError(f"暂不支持 {suffix or '无扩展名'} 文件（目前 .bkp 与 .apw 在真机上验证过）{hint}")
        self._source = path
        self._source_sha = sha256_file(path)
        self._work = Path(self._workdir_arg or tempfile.mkdtemp(prefix="aspen-study-"))
        self._work.mkdir(parents=True, exist_ok=True)
        self._copy = self._work / ("input" + suffix)
        shutil.copy2(path, self._copy)
        self._baseline = aspen_pids(self._ops)
        try:
            doc, progid = self._new_document()
        except AspenError:
            raise
        except Exception as exc:
            raise AspenUnavailable(f"无法启动 Aspen Plus：{exc}") from exc
        self._doc = doc
        try:
            self._pid = int(doc.ProcessId)
        except Exception:
            self._pid = None
        try:
            try:
                doc.SuppressDialogs = 1
            except Exception:
                pass
            getattr(doc, self._methods[suffix])(str(self._copy))
            try:
                doc.Visible = 0
            except Exception:
                pass
            self._tree = doc.Tree
        except Exception as exc:
            self.close()
            raise ModelOpenError(f"Aspen 打不开这个模型（文件损坏、版本过新或需要许可证）：{self._brief(exc)}") from exc
        version = self.scalar(STATUS_BRANCH + r"\VERNO")
        self._model = {"file": path.name, "sha256": self._source_sha, "simulator": "aspen-plus",
                       "version": str(version.value) if version else None, "progid": progid, "adapter": self.name}

    def _new_document(self):
        if self._doc_factory is not None:
            made = self._doc_factory()
            return made if isinstance(made, tuple) else (made, "injected")
        try:
            import pythoncom
            pythoncom.CoInitialize()
            self._com_inited = True
        except ImportError as exc:
            raise AspenUnavailable("缺少 pywin32（或不是 Windows）。请在装有 Aspen Plus 的 Windows 电脑上，"
                                   "用 pip install pywin32 后重试。") from exc
        try:
            from aspen_connection import create_aspen_document_ex
        except ImportError as exc:
            raise AspenUnavailable("找不到 aspen_connection.py；请在仓库根目录运行。") from exc
        try:
            return create_aspen_document_ex()
        except RuntimeError as exc:
            raise AspenUnavailable(str(exc)) from exc

    # ------------------------------------------------------------------ 节点读取
    @staticmethod
    def _brief(exc):
        text = str(exc)
        return text if len(text) < 200 else text[:200] + "…"

    def _lost(self, exc):
        if getattr(exc, "hresult", None) in _LOST_HRESULTS:
            raise AspenConnectionLost("Aspen 进程中途消失（崩溃或被结束），本次结果作废。") from exc

    def _find(self, path):
        if self._tree is None:
            raise RuntimeError("适配器还没有 open() 模型")
        self._reads += 1
        try:
            return self._tree.FindNode(path)
        except Exception as exc:
            self._lost(exc)
            return None

    def _attr(self, node, name, default=None):
        try:
            return getattr(node, name)
        except Exception as exc:
            self._lost(exc)
            return default

    def children(self, path):
        node = self._find(path)
        if node is None:
            return None
        try:
            elements = node.Elements
            return [elements.Item(i).Name for i in range(elements.Count)]
        except Exception as exc:
            self._lost(exc)
            return None

    def texts(self, path):
        """文本集合节点（如 PER_ERROR）的所有行；节点不存在给 []。"""
        node = self._find(path)
        if node is None:
            return []
        out = []
        try:
            elements = node.Elements
            for i in range(elements.Count):
                try:
                    out.append(elements.Item(i).Value)
                except Exception as exc:
                    self._lost(exc)
        except Exception as exc:
            self._lost(exc)
        return [x if isinstance(x, str) else ("" if x is None else str(x)) for x in out]

    def scalar(self, path):
        """标量节点 -> Reading；不存在、无值、向量/集合占位都返回 None。"""
        node = self._find(path)
        if node is None:
            return None
        dim = self._attr(node, "Dimension", 0)
        if isinstance(dim, (int, float)) and dim > 0:
            return None
        value = self._attr(node, "Value", None)
        if value is None:
            return None
        unit = self._attr(node, "UnitString", "") or ""
        return Reading(path, value, str(unit))

    def number(self, path):
        r = self.scalar(path)
        if r is None or isinstance(r.value, bool) or not isinstance(r.value, (int, float)):
            return None
        return r

    def profile_last(self, path, max_depth=3):
        """剖面（如 RPlug 的 B_TEMP\\MIXED，101 个点）的最后一点 = 出口值。"""
        node = self._find(path)
        unit = ""
        for _ in range(max_depth + 1):
            if node is None:
                return None
            unit = self._attr(node, "UnitString", "") or unit
            try:
                count = node.Elements.Count
            except Exception as exc:
                self._lost(exc)
                count = 0
            if not count:
                value = self._attr(node, "Value", None)
                dim = self._attr(node, "Dimension", 0)
                if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or (dim or 0) > 0:
                    return None
                return Reading(path, value, str(unit))
            node = node.Elements.Item(count - 1)
        return None

    def read(self, path):
        try:
            node = self._find(path)
        except AspenConnectionLost as exc:
            return Reading(path, error=str(exc))
        if node is None:
            return Reading(path, error="节点不存在")
        try:
            return Reading(path, node.Value, str(node.UnitString or ""))
        except Exception as exc:
            return Reading(path, error=self._brief(exc))

    # ------------------------------------------------------------------ 运行
    def run(self, timeout_s=None):
        limit = self.timeout_s if timeout_s is None else timeout_s
        engine = self._doc.Engine
        started = time.monotonic()
        self._finished, self._run_error, self._report = False, None, None
        self._start_watchdog(limit + 60)
        try:
            engine.Reinit()
            engine.Run2(1)
            while engine.IsRunning:
                if time.monotonic() - started > limit:
                    self._stop_engine(engine)
                    raise AspenTimeout(f"Aspen 运行超过 {limit} 秒，已请求停止。可用 --timeout 调大，或检查模型是否收敛。")
                time.sleep(self.poll_s)
            self._finished = True
        except AspenError as exc:
            self._run_error = str(exc)
            raise
        except Exception as exc:
            try:
                self._lost(exc)
            except AspenConnectionLost as lost:
                self._run_error = str(lost)
                raise lost
            self._run_error = f"引擎运行出错：{self._brief(exc)}"
            raise AspenError(self._run_error) from exc
        finally:
            self._stop_watchdog()
            self._run_secs = round(time.monotonic() - started, 1)

    def _stop_engine(self, engine):
        try:
            engine.Stop()
        except Exception:
            pass
        deadline = time.monotonic() + self.grace_s
        while time.monotonic() < deadline:
            try:
                if not engine.IsRunning:
                    return
            except Exception:
                break
            time.sleep(0.5)
        # Stop 没用：只结束本次启动的 Aspen 进程，COM 调用随即报错返回
        self._killed += kill_ours(self._ops, self._baseline, self._root())

    def _start_watchdog(self, seconds):
        self._watchdog = threading.Timer(seconds, lambda: self._killed.extend(kill_ours(self._ops, self._baseline, self._root())))
        self._watchdog.daemon = True
        self._watchdog.start()

    def _stop_watchdog(self):
        if self._watchdog is not None:
            self._watchdog.cancel()
            self._watchdog = None

    # ------------------------------------------------------------------ 状态
    def run_report(self):
        """本次运行的完整状态（含逐块消息）；给 CLI 和界面用，graph.json 只保留 schema 规定的部分。"""
        if self._report is not None:
            return self._report
        blocks = {}
        for b in self.children(r"\Data\Blocks") or []:
            out = BLOCK_OUT.format(b=b)
            code = self.number(out + r"\BLKSTAT")
            blkmsg = self.scalar(out + r"\BLKMSG")
            messages = self.texts(out + r"\PER_ERROR")
            state, why = R.classify_block(None if code is None else code.value, messages)
            blocks[b] = {"blkstat": None if code is None else int(code.value), "state": state, "note": why,
                         "blkmsg": blkmsg.value if blkmsg else None,
                         "messages": [m for m in messages if str(m).strip()]}
        run_lines = self.texts(RUN_PER_ERROR)
        uos = self.number(UOSSTAT2)
        verdict = R.classify_run(self._finished, None if uos is None else int(uos.value), run_lines, blocks)
        raw = {k: (lambda r: None if r is None else r.value)(self.scalar(f"{STATUS_BRANCH}\\{k}"))
               for k in ("UOSSTAT", "UOSSTAT2", "CVSTAT", "CSSTAT", "RSTAT", "PPSTAT", "SENSSTAT", "ITSTAT", "SSTAT")}
        self._report = {"state": verdict["state"], "run_completed": verdict["run_completed"],
                        "errors": verdict["errors"], "warnings": verdict["warnings"], "notes": verdict["notes"],
                        "blocks": blocks, "run_status_lines": [x for x in run_lines if str(x).strip()],
                        "raw_status": raw, "run_seconds": self._run_secs, "run_error": self._run_error}
        return self._report

    def status(self):
        rep = self.run_report()
        return RunStatus(run_completed=rep["run_completed"], errors=list(rep["errors"]), warnings=list(rep["warnings"]),
                         block_status={b: i["blkstat"] for b, i in rep["blocks"].items()},
                         block_status_accepted=list(R.BLK_OK + R.BLK_WARN))

    def model_info(self):
        return dict(self._model)

    # ------------------------------------------------------------------ 结构
    def components(self):
        base = r"\Data\Components\Specifications\Input"
        out = []
        for cid in self.children(base + r"\TYPE") or []:
            item = {"id": cid}
            alias = self.scalar(f"{base}\\ANAME\\{cid}")
            if alias and isinstance(alias.value, str) and alias.value.strip():
                item["alias"] = alias.value.strip()
            cas = self.scalar(f"{base}\\CASN\\{cid}")
            if cas and isinstance(cas.value, str) and re.fullmatch(r"[0-9]{2,7}-[0-9]{2}-[0-9]", cas.value.strip()):
                item["cas"] = cas.value.strip()
            kind = self.scalar(f"{base}\\TYPE\\{cid}")
            if kind and isinstance(kind.value, str) and kind.value.strip():
                item["type"] = kind.value.strip()
            out.append(item)
        return out

    def _block_ports(self, bid):
        ports = {"in": [], "out": []}
        for port in self.children(rf"\Data\Blocks\{bid}\Ports") or []:
            m = re.fullmatch(r"(.+)\((IN|OUT)\)", port)
            if not m:
                continue
            for stream in self.children(rf"\Data\Blocks\{bid}\Ports\{port}") or []:
                ports["in" if m.group(2) == "IN" else "out"].append(stream)
        return ports

    def blocks(self):
        if "blocks" in self._graph_parts:
            return self._graph_parts["blocks"]
        out = []
        for bid in self.children(r"\Data\Blocks") or []:
            node = self._find(rf"\Data\Blocks\{bid}")
            model = None
            try:
                model = node.AttributeValue(6)
            except Exception as exc:
                self._lost(exc)
            model = str(model) if model else "Unknown"
            recipe = R.recipe_for(model)
            block = {"id": bid, "type": model, "ports": self._block_ports(bid), "energy": []}
            energy, temp_nodes = [], []
            if recipe is None:
                self._unmatched.add(model)
                energy = self._generic_energy(bid)
            else:
                energy = self._recipe_energy(bid, model, recipe)
                temp_nodes = recipe["temp"]
            block["energy"] = energy
            for tnode in temp_nodes:
                path = BLOCK_OUT.format(b=bid) + "\\" + tnode
                reading = self.number(path) or self.profile_last(path)
                if reading is not None:
                    block["outlet_temperature"] = {"value": float(reading.value), "unit": reading.unit, "path": path}
                    break
            out.append(block)
        self._graph_parts["blocks"] = out
        return out

    def _energy_entry(self, bid, kind, hint, reading):
        e = {"kind": kind, "value": float(reading.value), "unit": reading.unit, "path": reading.path}
        if hint:
            e["role_hint"] = hint
        if float(reading.value) == 0.0:
            e["explicit_zero"] = True
        return e

    def _recipe_energy(self, bid, model, recipe):
        energy = []
        for kind, hint, nodes, verified in recipe["energy"]:
            found = None
            for n in nodes:
                found = self.number(BLOCK_OUT.format(b=bid) + "\\" + n)
                if found is not None:
                    if not verified:
                        self._unverified.add(f"{model}: {n}")
                    break
            if found is None:
                self._missing.append(f"{bid}（{model}）{hint or kind}：{'/'.join(nodes)} 都读不到")
            else:
                energy.append(self._energy_entry(bid, kind, hint, found))
        return energy

    def _generic_energy(self, bid):
        energy = []
        for kind, nodes in (("heat", R.GENERIC_HEAT), ("work", R.GENERIC_WORK)):
            for n in nodes:
                found = self.number(BLOCK_OUT.format(b=bid) + "\\" + n)
                if found is not None:
                    energy.append(self._energy_entry(bid, kind, None, found))
                    self._unverified.add(f"通用 {n}")
                    break
        return energy

    def streams(self):
        blocks = self.blocks()
        source, dest = {}, {}
        for b in blocks:
            for s in b["ports"]["out"]:
                source.setdefault(s, b["id"])
            for s in b["ports"]["in"]:
                dest.setdefault(s, b["id"])
        out = []
        for sid in self.children(r"\Data\Streams") or []:
            node = self._find(rf"\Data\Streams\{sid}")
            cls = None
            try:
                cls = node.AttributeValue(6)
            except Exception as exc:
                self._lost(exc)
            cls = str(cls).upper() if cls else "MATERIAL"
            if cls not in ("MATERIAL", "HEAT", "WORK"):
                self._unverified.add(f"流股类别 {cls}（按 MATERIAL 处理）")
                cls = "MATERIAL"
            stream = {"id": sid, "class": cls, "from": source.get(sid, "BOUNDARY"), "to": dest.get(sid, "BOUNDARY")}
            if cls == "MATERIAL":
                total = {}
                for key, (node_name, unit_key) in STREAM_NODES.items():
                    r = self.number(rf"\Data\Streams\{sid}\Output\{node_name}\MIXED")
                    if r is None:
                        continue
                    value = float(r.value)
                    if key == "mass_flow" and value < 0:
                        if value > -1e-9:
                            value = 0.0
                        else:
                            continue
                    total[key] = value
                    if r.unit:
                        total[unit_key] = r.unit
                if total:
                    stream["total"] = total
                subs = {}
                for sub in self.children(rf"\Data\Streams\{sid}\Output\MASSFLMX") or ["MIXED"]:
                    comps = {}
                    unit = ""
                    for c in self.children(rf"\Data\Streams\{sid}\Output\MASSFLOW\{sub}") or []:
                        r = self.number(rf"\Data\Streams\{sid}\Output\MASSFLOW\{sub}\{c}")
                        if r is not None:
                            v = float(r.value)
                            comps[c] = 0.0 if -1e-9 < v < 0 else v  # 数值噪声的极小负值归零；明显为负的丢弃（schema 要求 >=0）
                            unit = unit or r.unit
                    if comps:
                        subs[sub] = {"mass_unit": unit, "mass_by_component": {k: v for k, v in comps.items() if v >= 0}}
                    if sub != "MIXED":
                        self._unverified.add(f"非 MIXED 子流股 {sub}")
                if subs:
                    stream["substreams"] = subs
            else:
                self._unverified.add(f"{cls} 流股负荷节点（块负荷已计，流股 duty 未读取）")
            out.append(stream)
        return out

    def units_info(self):
        g = r"\Data\Setup\Global\Input"
        info = {}
        for key in ("INSET", "OUTSET"):
            r = self.scalar(f"{g}\\{key}")
            if r and r.value:
                info[key] = str(r.value)
        info["calorie_J"] = self.calorie_J
        info["note"] = ("块负荷与流股焓流保留各节点自己的 UnitString，不假设 kW（MET 的热负荷是 cal/sec，ENG 是 Btu/hr）。"
                        "1 cal = 4.1868 J 经真机核对（同一结果在 MET 与 SI 下各读一次，比值 4.1868）。")
        return info

    def discovery_info(self):
        self.blocks()
        info = {"mode": "recipe", "nodes_read": self._reads,
                "complete": not self._unmatched and not self._missing and self._finished,
                "unmatched_block_types": sorted(self._unmatched), "unverified_paths": sorted(self._unverified)}
        return info

    def energy_gaps(self):
        return list(self._missing)

    # ------------------------------------------------------------------ 收尾
    def close(self):
        """幂等；关闭私有文档，并确认本次启动的 Aspen 进程已退出。"""
        self._stop_watchdog()
        doc, self._doc, self._tree = self._doc, None, None
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
        deadline = time.monotonic() + (min(5.0, self.grace_s) if self._pid else 0)
        while self._pid and time.monotonic() < deadline:
            if not self._leftovers():
                break
            time.sleep(0.5)
        if self._leftovers():
            self._killed += kill_ours(self._ops, self._baseline, self._root())
        if self._com_inited:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except Exception:
                pass
            self._com_inited = False
        if self._source is not None and self._source.exists():
            self.source_unchanged = (sha256_file(self._source) == self._source_sha)
        if self._work is not None and not self.keep_workdir and self._workdir_arg is None:
            shutil.rmtree(self._work, ignore_errors=True)

    def _leftovers(self):
        return started_by_us(self._ops, self._baseline, self._root())

    def _root(self):
        return self._pid if self._pid is not None else -1

    def cleaned_pids(self):
        return list(self._killed)
