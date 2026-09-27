"""Multi-device case generator used by the desktop interface."""
import tkinter as tk
from tkinter import ttk, messagebox
from parameter_catalog import build_cases, coerce_value
from parameter_labels import parameter_title


class MultiScanDialog(tk.Toplevel):
    def __init__(self, parent, catalog, baseline=None):
        super().__init__(parent)
        self.title("按参数取值生成运行行")
        self.geometry("880x610")
        self.minsize(790, 570)
        self.catalog = catalog
        self.baseline = baseline or {}
        self.result_cases = []
        self.rules = {}
        self.columnconfigure(0, weight=1)
        self.rowconfigure(6, weight=1)
        ttk.Label(self, text="为每个参数列填写一组取值，自动生成多行。", font=("Microsoft YaHei UI", 12, "bold")).grid(row=0, column=0, sticky="w", padx=16, pady=(14, 5))
        ttk.Label(self, text="每行仍只运行一次；一个固定值可用于所有行。未修改的列沿用当前选中行的设置。", wraplength=830).grid(row=1, column=0, sticky="w", padx=16, pady=(0, 10))
        self.choices = {}
        for key, spec in catalog.items():
            title = f"{parameter_title(key, catalog)} [{spec.get('unit') or '单位待核对'}]"
            if title in self.choices:
                title += f" ({spec['label']})"
            self.choices[title] = key
        self.key = tk.StringVar()
        self.combo = ttk.Combobox(self, textvariable=self.key, values=list(self.choices), width=95, state="readonly")
        self.combo.grid(row=2, column=0, sticky="ew", padx=12)
        self.combo.bind("<<ComboboxSelected>>", self.show_unit)
        self.unit = ttk.Label(self, text="")
        self.unit.grid(row=3, column=0, sticky="w", padx=12)
        if self.choices:
            self.combo.current(0)
            self.show_unit()
        row = ttk.Frame(self)
        row.grid(row=4, column=0, sticky="ew", padx=12, pady=6)
        ttk.Label(row, text="本列取值（逗号分隔）：").pack(side="left")
        self.values = ttk.Entry(row, width=40)
        self.values.pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="加入取值列表", command=self.add_rule).pack(side="left", padx=8)
        range_row = ttk.Frame(self)
        range_row.grid(row=5, column=0, sticky="ew", padx=12)
        self.range_fields = []
        for label, default in (("起始", ""), ("终止", ""), ("点数", "5")):
            ttk.Label(range_row, text=label).pack(side="left")
            entry = ttk.Entry(range_row, width=10)
            entry.insert(0, default)
            entry.pack(side="left", padx=4)
            self.range_fields.append(entry)
        ttk.Button(range_row, text="生成等间隔取值", command=self.from_range).pack(side="left")
        self.table = ttk.Treeview(self, columns=("key", "values"), show="headings", height=8)
        self.table.heading("key", text="参数列")
        self.table.heading("values", text="取值")
        self.table.grid(row=6, column=0, sticky="nsew", padx=12, pady=8)
        ttk.Button(self, text="移除所选取值规则", command=self.remove).grid(row=7, column=0, sticky="w", padx=12)
        self.mode = tk.StringVar(value="linked")
        bottom = ttk.Frame(self)
        bottom.grid(row=8, column=0, sticky="ew", padx=12, pady=12)
        ttk.Radiobutton(bottom, text="逐行配对（2 + 2 个值 → 2 行）", variable=self.mode, value="linked").pack(side="left")
        ttk.Radiobutton(bottom, text="所有组合（2 × 3 个值 → 6 行）", variable=self.mode, value="factorial").pack(side="left")
        ttk.Button(bottom, text="添加到运行表", command=self.confirm).pack(side="right")
        self.preview = ttk.Label(self, text="先添加参数取值，再选择生成方式。", foreground="#176b72")
        self.preview.grid(row=9, column=0, sticky="w", padx=16, pady=(0, 12))
        self.mode.trace_add("write", lambda *_: self.update_preview())
        self.transient(parent)
        self.grab_set()
        self.wait_window()

    def show_unit(self, event=None):
        key = self.choices.get(self.key.get(), self.key.get())
        spec = self.catalog[key]
        self.unit.config(text=f"模型原值：{spec.get('value')}   单位：{spec.get('unit') or '待核对'}")

    def from_range(self):
        try:
            start, end = (float(e.get()) for e in self.range_fields[:2])
            count = int(self.range_fields[2].get())
            if not 2 <= count <= 10000:
                raise ValueError("点数应在 2 至 10000 之间")
            values = [coerce_value(start + (end-start)*i/(count-1)) for i in range(count)]
            self.values.delete(0, "end")
            self.values.insert(0, ", ".join(format(v, '.12g') for v in values))
        except ValueError as exc:
            messagebox.showerror("范围无效", str(exc), parent=self)

    def add_rule(self):
        try:
            key = self.choices.get(self.key.get(), self.key.get())
            if key not in self.catalog:
                raise ValueError("请先选择参数")
            parts = self.values.get().replace("，", ",").split(",")
            if any(not part.strip() for part in parts):
                raise ValueError("取值不能为空")
            values = [coerce_value(p.strip(), self.catalog[key].get("value")) for p in parts]
            self.rules[key] = values
            self.table.delete(*self.table.get_children())
            self.rule_items = {}
            for name, vals in self.rules.items():
                item = self.table.insert("", "end", values=(parameter_title(name, self.catalog), ", ".join(map(str, vals))))
                self.rule_items[item] = name
            self.update_preview()
        except ValueError as exc:
            messagebox.showerror("参数无效", str(exc), parent=self)

    def remove(self):
        for item in self.table.selection():
            self.rules.pop(self.rule_items[item])
            self.table.delete(item)
        self.update_preview()

    def update_preview(self):
        try:
            count = len(build_cases(self.rules, self.mode.get(), self.baseline))
            self.preview.config(text=f"将新增 {count} 行 = {count} 次运行；每行一起设置 {len(set(self.rules) | set(self.baseline))} 个参数。", foreground="#176b72")
        except ValueError as exc:
            self.preview.config(text=str(exc), foreground="#b42318")

    def confirm(self):
        try:
            self.result_cases = build_cases(self.rules, self.mode.get(), self.baseline)
        except ValueError as exc:
            messagebox.showerror("无法生成", str(exc), parent=self)
            return
        self.destroy()
