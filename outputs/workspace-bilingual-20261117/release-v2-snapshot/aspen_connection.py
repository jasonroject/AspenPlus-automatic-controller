"""Create private Aspen documents using the installed COM registrations.

Some installations register only versioned ProgIDs (for example V15's
Apwn.Document.41.0). Never attach to the user's open Aspen document.
"""
import re


def registered_document_progids():
    import winreg

    versions = set()
    # Inspect both registry views when Python and Aspen have different bitness.
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "", 0,
                                winreg.KEY_READ | view) as root:
                for index in range(winreg.QueryInfoKey(root)[0]):
                    name = winreg.EnumKey(root, index)
                    if re.fullmatch(r"Apwn\.Document\.\d+\.\d+", name):
                        versions.add(name)
        except OSError:
            continue
    return sorted(versions, key=lambda name: tuple(map(int, name.split(".")[2:])),
                  reverse=True)


def create_aspen_document():
    """Prefer installed versioned classes; retry only missing registrations.

    Callers initialise COM on their own thread and close the returned document.
    License/startup errors must remain visible rather than selecting another
    Aspen version silently.
    """
    try:
        import pywintypes
        import win32com.client
    except ImportError as exc:
        raise RuntimeError("缺少 pywin32，请用启动程序的 Python 安装 pywin32。") from exc

    candidates = registered_document_progids() + ["Apwn.Document"]
    last_error = None
    for progid in candidates:
        try:
            return win32com.client.DispatchEx(progid)
        except pywintypes.com_error as exc:
            # CO_E_CLASSSTRING / REGDB_E_CLASSNOTREG; other errors are actionable.
            if exc.hresult not in (-2147221005, -2147221164):
                raise RuntimeError(f"无法启动 Aspen 接口 {progid}：{exc}") from exc
            last_error = exc
    raise RuntimeError("未找到可用的 Aspen Plus 自动化接口。请确认已安装 Aspen Plus，"
                       "并修复其 COM 注册。尝试过：" + ", ".join(candidates)) from last_error
