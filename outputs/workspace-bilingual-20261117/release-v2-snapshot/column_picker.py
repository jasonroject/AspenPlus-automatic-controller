"""Searchable, multi-select parameter column picker."""
import tkinter as tk
from tkinter import ttk, messagebox
from parameter_labels import parameter_name, is_common, parameter_detail


class ColumnPicker(tk.Toplevel):
    def __init__(self, parent, catalog, existing=()):
        super().__init__(parent)
        self.title("添加参数列")
        self.geometry("850x590")
        self.minsize(740, 500)
        self.catalog = catalog
        self.existing = set(existing)
        self.selected_keys = []
        self.chosen = set()
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)
        self.item_keys = {}
        self.query = tk.StringVar()
        self.common = tk.BooleanVar(value=True)
        ttk.Label(self, text="每选择一个参数，就会在运行表格中增加一列。", font=("Microsoft YaHei UI", 11, "bold")).grid(row=0, column=0, sticky="w", padx=16, pady=(14, 4))
        ttk.Label(self, text="可跨设备选择多个参数；已有列不会重复添加。新增单元格留空，表示沿用模型原值。").grid(row=1, column=0, sticky="w", padx=16)
        bar = ttk.Frame(self, padding=(16, 10))
        bar.grid(row=2, column=0, sticky="ew")
        ttk.Label(bar, text="搜索").pack(side="left", padx=(0, 6))
        entry = ttk.Entry(bar, textvariable=self.query)
        entry.pack(side="left", fill="x", expand=True)
        ttk.Checkbutton(bar, text="仅显示常用参数", variable=self.common, command=self.populate).pack(side="left", padx=(12, 0))
        wrap = ttk.Frame(self, padding=(16, 0))
        wrap.grid(row=3, column=0, sticky="nsew")
        self.tree = ttk.Treeview(wrap, columns=("chosen", "owner", "name", "value", "unit"), show="headings", selectmode="browse")
        for col, title, width in (("chosen", "选择", 65), ("owner", "设备 / 物流", 135), ("name", "参数", 255), ("value", "模型原值", 105), ("unit", "单位", 95)):
            self.tree.heading(col, text=title)
            self.tree.column(col, width=width, stretch=col == "name")
        scrollbar = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<ButtonRelease-1>", self.toggle)
        self.tree.bind("<space>", self.toggle)
        self.tree.bind("<<TreeviewSelect>>", self.show_detail)
        self.detail = ttk.Label(self, text="点击参数行选择，再次点击取消。", wraplength=810, foreground="#536479")
        self.detail.grid(row=4, column=0, sticky="ew", padx=16, pady=10)
        footer = ttk.Frame(self, padding=(16, 0, 16, 14))
        footer.grid(row=5, column=0, sticky="ew")
        self.count = ttk.Label(footer)
        self.count.pack(side="left")
        ttk.Button(footer, text="取消", command=self.destroy).pack(side="right", padx=(8, 0))
        ttk.Button(footer, text="添加所选列", command=self.confirm).pack(side="right")
        self.query.trace_add("write", lambda *_: self.populate())
        self.populate()
        self.transient(parent)
        self.grab_set()
        entry.focus_set()
        self.wait_window()

    def populate(self):
        self.tree.delete(*self.tree.get_children())
        self.item_keys = {}
        query = self.query.get().strip().casefold()
        for key, spec in self.catalog.items():
            searchable = f"{key} {parameter_name(spec)} {spec.get('unit', '')}".casefold()
            if query and query not in searchable:
                continue
            if self.common.get() and not query and not is_common(spec):
                continue
            state = "已添加" if key in self.existing else ("☑" if key in self.chosen else "☐")
            group = "设备" if spec["section"] == "Blocks" else "物流"
            item = self.tree.insert("", "end", values=(state, f"{group} {spec['owner']}", parameter_name(spec), spec.get("value", ""), spec.get("unit") or "待核对"))
            self.item_keys[item] = key
        self.count.config(text=f"已选 {len(self.chosen)} 列 · 显示 {len(self.item_keys)} 个参数")

    def toggle(self, event=None):
        if event is not None and getattr(event, "keysym", "") != "space":
            item = self.tree.identify_row(event.y)
        else:
            item = self.tree.focus()
        key = self.item_keys.get(item)
        if not key or key in self.existing:
            return
        if key in self.chosen:
            self.chosen.remove(key)
        else:
            self.chosen.add(key)
        self.tree.set(item, "chosen", "☑" if key in self.chosen else "☐")
        self.count.config(text=f"已选 {len(self.chosen)} 列 · 显示 {len(self.item_keys)} 个参数")
        self.detail.config(text=parameter_detail(key, self.catalog))
        return "break"

    def show_detail(self, event=None):
        key = self.item_keys.get(self.tree.focus())
        if key:
            self.detail.config(text=parameter_detail(key, self.catalog))

    def confirm(self):
        if not self.chosen:
            messagebox.showinfo("尚未选择", "请点击需要添加的参数行。", parent=self)
            return
        self.selected_keys = [key for key in self.catalog if key in self.chosen]
        self.destroy()
