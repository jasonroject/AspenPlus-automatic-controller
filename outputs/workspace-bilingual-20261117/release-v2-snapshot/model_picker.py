"""Native model picker, isolated from the threaded web server's Tk lifecycle."""
import argparse
import json
from pathlib import Path


def select_model(initial_path=""):
    import tkinter as tk
    from tkinter import filedialog

    initial = Path(initial_path.strip().strip('"')) if initial_path.strip() else None
    directory = initial if initial and initial.is_dir() else initial.parent if initial else None
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        options = dict(parent=root, title="选择 Aspen Plus 模型",
                       filetypes=[("Aspen Plus 模型 (*.bkp)", "*.bkp")])
        if directory and directory.is_dir():
            options["initialdir"] = str(directory)
        if initial and initial.is_file():
            options["initialfile"] = initial.name
        return filedialog.askopenfilename(**options) or None
    finally:
        root.destroy()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--initial-path", default="")
    args = parser.parse_args()
    try:
        print(json.dumps({"model_path": select_model(args.initial_path)}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": f"无法打开文件选择窗口：{exc}"}, ensure_ascii=False))
        raise SystemExit(1)
