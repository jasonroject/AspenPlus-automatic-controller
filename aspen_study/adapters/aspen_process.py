"""只清理"本次启动"的 Aspen 进程，绝不碰用户已打开的会话。

规则：被清理的进程必须同时满足
  1. 映像名属于 Aspen（AspenPlus / apmain / ...）；
  2. 不在 open() 之前的基线快照里；
  3. 是 doc.ProcessId 的子孙，或其父进程已不存在（孤儿）。
Windows 上用 ctypes 的 ToolHelp 快照，不依赖 psutil / wmic。
"""
from __future__ import annotations

import os
import subprocess
import sys

ASPEN_IMAGES = ("aspenplus.exe", "apmain.exe", "apwn.exe", "aspenengine.exe", "apserver.exe")


class WindowsProcessOps:
    """进程操作的可替换实现；测试里用假对象代替。"""

    def snapshot(self):
        """返回 {pid: (ppid, image_lower)}；非 Windows 返回空表。"""
        if sys.platform != "win32":
            return {}
        import ctypes
        from ctypes import wintypes

        class ENTRY(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                        ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD),
                        ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                        ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                        ("szExeFile", ctypes.c_wchar * 260)]
        k32 = ctypes.windll.kernel32
        k32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
        snap = k32.CreateToolhelp32Snapshot(0x2, 0)
        table = {}
        try:
            entry = ENTRY()
            entry.dwSize = ctypes.sizeof(ENTRY)
            ok = k32.Process32FirstW(ctypes.c_void_p(snap), ctypes.byref(entry))
            while ok:
                table[int(entry.th32ProcessID)] = (int(entry.th32ParentProcessID), entry.szExeFile.lower())
                ok = k32.Process32NextW(ctypes.c_void_p(snap), ctypes.byref(entry))
        finally:
            k32.CloseHandle(ctypes.c_void_p(snap))
        return table

    def kill(self, pid):
        subprocess.run(["taskkill", "/PID", str(int(pid)), "/F", "/T"], capture_output=True, timeout=30,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def aspen_pids(ops):
    return {pid for pid, (_, image) in ops.snapshot().items() if image in ASPEN_IMAGES}


def descendants(table, root):
    out, frontier = set(), {root}
    while frontier:
        nxt = {pid for pid, (ppid, _) in table.items() if ppid in frontier and pid not in out and pid != root}
        out |= nxt
        frontier = nxt
    return out


def started_by_us(ops, baseline, root_pid):
    """open() 之后新出现的、确属本次会话的 Aspen 进程集合。"""
    table = ops.snapshot()
    mine = descendants(table, root_pid) | ({root_pid} if root_pid in table else set())
    out = set()
    for pid, (ppid, image) in table.items():
        if image not in ASPEN_IMAGES or pid in baseline:
            continue
        if pid in mine or ppid not in table:
            out.add(pid)
    return out


def kill_ours(ops, baseline, root_pid):
    """杀掉本次启动的 Aspen 进程，返回被杀的 pid 列表。"""
    killed = []
    for pid in sorted(started_by_us(ops, baseline, root_pid)):
        try:
            ops.kill(pid)
            killed.append(pid)
        except Exception:
            pass
    return killed
