"""Aspen Plus 批处理运行器 - 图形化界面"""
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext, simpledialog
import threading
import json
from pathlib import Path
from datetime import datetime
import sys
import csv
import io

sys.path.insert(0, str(Path(__file__).resolve().parent))
from batch_runner import BatchRunner
from parameter_catalog import discover_parameters, legacy_catalog, coerce_value
from scan_dialog import MultiScanDialog
from types import SimpleNamespace
from column_picker import ColumnPicker
from parameter_labels import column_title, parameter_title, parameter_detail
from aspen_connection import create_aspen_document


class BatchRunnerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Aspen Plus · 批量运行表")
        self.root.geometry("1280x820")
        self.root.minsize(1040, 720)

        self.catalog = {}
        self.param_items = {}
        self.model_path = None
        self.control_module = None
        self.is_running = False
        self.stop_requested = False
        self.runner = None
        # 动态表格中的参数列，保存 Aspen 参数键，例如 REACTOR.反应温度
        self.parameter_columns = []

        self.editor = None
        self._edit_location = None
        self.active_column = 1
        self.run_row_ids = []
        self.create_widgets()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _on_close(self):
        if self.is_running:
            self.stop_requested = True
            self.log("正在等待当前模型操作结束；完成后可关闭窗口。")
            return
        self.root.destroy()

    def create_widgets(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background="#f3f6fa")
        style.configure("TLabel", background="#f3f6fa", foreground="#21334a", font=("Microsoft YaHei UI", 10))
        style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(10, 6))
        style.configure("Accent.TButton", background="#176b72", foreground="white", padding=(15, 7))
        style.map("Accent.TButton", background=[("disabled", "#cad5df"), ("active", "#135c62")])
        style.configure("Treeview", rowheight=32, font=("Microsoft YaHei UI", 10), background="white", fieldbackground="white", borderwidth=0)
        style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 10, "bold"), background="#e6edf5", foreground="#21334a", padding=(7, 7))
        style.map("Treeview", background=[("selected", "#d6eaf4")], foreground=[("selected", "#163f5d")])
        self.root.configure(background="#f3f6fa")
        page = ttk.Frame(self.root, padding=18)
        page.pack(fill="both", expand=True)
        heading = ttk.Frame(page)
        page.columnconfigure(0, weight=1)
        page.rowconfigure(6, weight=1)
        heading.grid(row=0, column=0, sticky="ew")
        ttk.Label(heading, text="批量运行表", font=("Microsoft YaHei UI", 21, "bold")).pack(side="left")
        ttk.Label(heading, text="一行运行一次  ·  一列设置一个参数", foreground="#536479").pack(side="left", padx=22)
        top = ttk.Frame(page, padding=(0, 12))
        top.grid(row=1, column=0, sticky="ew")
        self.edit_controls = []
        def button(parent, text, command, **kwargs):
            widget = ttk.Button(parent, text=text, command=command, **kwargs)
            widget.pack(side="left", padx=(0, 8))
            self.edit_controls.append(widget)
            return widget
        button(top, "打开 Aspen 模型…", self.scan_model_inputs, style="Accent.TButton")
        button(top, "打开运行表…", self.load_cfg)
        button(top, "保存运行表…", self.save_cfg)
        advanced = ttk.Menubutton(top, text="更多", padding=(8, 6))
        menu = tk.Menu(advanced, tearoff=False)
        menu.add_command(label="从旧版控制脚本导入…", command=self.load_script)
        menu.add_command(label="清空运行表", command=self.clear_all)
        advanced.configure(menu=menu)
        advanced.pack(side="left")
        self.edit_controls.append(advanced)
        self.model_label = ttk.Label(page, text="尚未打开模型。先打开 .bkp 文件，或载入已保存的运行表。", foreground="#536479")
        self.model_label.grid(row=2, column=0, sticky="ew", pady=(0, 14))
        tools = ttk.Frame(page)
        tools.grid(row=3, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(tools, text="运行行", width=7, font=("Microsoft YaHei UI", 10, "bold")).pack(side="left")
        button(tools, "+ 添加运行行", self.add_row)
        button(tools, "复制选中行", self.duplicate_rows)
        button(tools, "删除选中行", self.del_row)
        button(tools, "按范围生成多行…", self._show_scan_dialog)
        cols = ttk.Frame(page)
        cols.grid(row=4, column=0, sticky="ew", pady=(0, 10))
        ttk.Label(cols, text="参数列", width=7, font=("Microsoft YaHei UI", 10, "bold")).pack(side="left")
        button(cols, "+ 添加参数列…", self.add_columns, style="Accent.TButton")
        button(cols, "删除当前列", self.remove_column)
        button(cols, "整列填值…", self.fill_column)
        button(cols, "粘贴表格", self.paste_table)
        button(cols, "复制选中行到 Excel", self.copy_table)
        self.summary_var = tk.StringVar()
        ttk.Label(page, textvariable=self.summary_var, foreground="#176b72").grid(row=5, column=0, sticky="w", pady=(0, 5))
        wrap = ttk.Frame(page)
        wrap.grid(row=6, column=0, sticky="nsew")
        self.table = ttk.Treeview(wrap, columns=("__index__", "__name__"), show="tree headings", selectmode="extended")
        self.table.heading("#0", text="运行状态")
        self.table.column("#0", width=86, stretch=False, anchor="center")
        self.table.tag_configure("even", background="#f4f8fc")
        self.table.tag_configure("failed", foreground="#b42318")
        self.table.tag_configure("success", foreground="#176b72")
        ybar = ttk.Scrollbar(wrap, orient="vertical", command=self.table.yview)
        xbar = ttk.Scrollbar(wrap, orient="horizontal", command=self.table.xview)
        self.table.configure(yscrollcommand=ybar.set, xscrollcommand=xbar.set)
        wrap.rowconfigure(0, weight=1)
        wrap.columnconfigure(0, weight=1)
        self.table.grid(row=0, column=0, sticky="nsew")
        ybar.grid(row=0, column=1, sticky="ns")
        xbar.grid(row=1, column=0, sticky="ew")
        self.empty_label = ttk.Label(wrap, text="先添加参数列，再添加运行行\n双击单元格填写每次运行的数值", anchor="center", justify="center", foreground="#708196", font=("Microsoft YaHei UI", 13))
        self.table.bind("<Double-1>", self.edit_cell)
        self.table.bind("<Button-1>", self._remember_active_cell, add="+")
        self.table.bind("<Button-3>", self._context_menu)
        for key, action in (("<Control-v>", self._paste_event), ("<Control-V>", self._paste_event), ("<Control-c>", self._copy_event), ("<Control-C>", self._copy_event), ("<Delete>", self._delete_cells)):
            self.table.bind(key, action)
        self.table.bind("<Return>", self._edit_selected)
        self.table.bind("<F2>", self._edit_selected)
        self.column_info = ttk.Label(page, text="点击参数列标题可选择整列；双击单元格编辑。空白 = 沿用原始模型值。", foreground="#536479", wraplength=1180)
        self.column_info.grid(row=7, column=0, sticky="ew", pady=(8, 10))
        bottom = ttk.Frame(page)
        bottom.grid(row=8, column=0, sticky="ew", pady=(0, 8))
        self.run_btn = ttk.Button(bottom, text="开始运行全部行", command=self.start, style="Accent.TButton")
        self.run_btn.pack(side="left")
        self.stop_btn = ttk.Button(bottom, text="当前行完成后停止", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left", padx=8)
        ttk.Button(bottom, text="打开结果文件夹", command=self.open_folder).pack(side="left")
        self.progress = ttk.Progressbar(bottom, mode="determinate")
        self.progress.pack(side="left", fill="x", expand=True, padx=12)
        self.prog_label = ttk.Label(bottom, text="尚未运行")
        self.prog_label.pack(side="left")
        ttk.Label(page, text="运行日志", font=("Microsoft YaHei UI", 10, "bold")).grid(row=9, column=0, sticky="w")
        self.log_text = scrolledtext.ScrolledText(page, height=4, wrap="word", font=("Microsoft YaHei UI", 9), borderwidth=0, background="#eaf0f6", foreground="#35465c")
        self.log_text.grid(row=10, column=0, sticky="ew", pady=(4, 0))
        page.bind("<Configure>", lambda e: self.column_info.configure(wraplength=max(300, e.width-36)))
        self._refresh_columns()
        self._update_summary()

    def log(self, msg):
        t = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{t}] {msg}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    # -----------------------------------------------------
    # 参数浏览器
    # ------------------------------------------------------------

    def _set_busy(self, busy):
        self.is_running = busy
        for widget in self.edit_controls:
            widget.configure(state="disabled" if busy else "normal")
        self.run_btn.configure(state="disabled" if busy else "normal")

    def _update_summary(self):
        rows = len(self.table.get_children())
        cols = len(self.parameter_columns)
        self.summary_var.set(f"{rows} 行 = {rows} 次运行    ·    {cols} 个参数列    ·    每行的参数一起写入，计算按行依次执行")
        self.run_btn.configure(text=f"开始运行全部 {rows} 行" if rows else "开始运行全部行")
        if rows:
            self.empty_label.place_forget()
        else:
            self.empty_label.place(relx=.5, rely=.42, anchor="center")

    def _refresh_columns(self):
        self.table.configure(columns=("__index__", "__name__", *(f"param_{i}" for i in range(len(self.parameter_columns)))))
        for col, title, width in (("__index__", "行号", 55), ("__name__", "运行名称", 145)):
            self.table.heading(col, text=title)
            self.table.column(col, width=width, stretch=False)
        for i, key in enumerate(self.parameter_columns):
            title = column_title(key, self.catalog)
            if i + 2 == self.active_column:
                title = "▸ " + title
            self.table.heading(f"param_{i}", text=title, command=lambda idx=i+2: self._select_column(idx))
            self.table.column(f"param_{i}", width=215, minwidth=140, stretch=False)

    def _select_column(self, index):
        if not self._finish_edit():
            return
        self.active_column = index
        self._refresh_columns()
        if 2 <= index < len(self.parameter_columns) + 2:
            key = self.parameter_columns[index - 2]
            self.column_info.config(text=parameter_detail(key, self.catalog) if key in self.catalog else key)

    def add_columns(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        if not self.catalog:
            messagebox.showinfo("先打开模型", "请先打开 Aspen 模型，读取可选参数。")
            return
        paths = {self.catalog.get(key, {}).get("path") for key in self.parameter_columns}
        existing = [key for key, spec in self.catalog.items() if spec.get("path") in paths]
        dialog = ColumnPicker(self.root, self.catalog, existing)
        self.add_parameter_columns(dialog.selected_keys)

    def add_parameter_columns(self, keys):
        if self.is_running:
            return
        added = 0
        for key in keys:
            if key not in self.catalog:
                raise ValueError(f"未知参数：{key}")
            path = self.catalog[key]["path"]
            if any(self.catalog.get(old, {}).get("path") == path for old in self.parameter_columns):
                continue
            self._ensure_parameter_column(key)
            added += 1
        if added and not self.table.get_children():
            self.add_row()
        if added:
            self._select_column(len(self.parameter_columns) + 1)
            self.log(f"已添加 {added} 个参数列。空白单元格沿用模型原值。")
        self._update_summary()

    def remove_column(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        index = self.active_column
        if not 2 <= index < len(self.parameter_columns) + 2:
            messagebox.showinfo("选择参数列", "请先点击要删除的参数列标题。")
            return
        key = self.parameter_columns[index - 2]
        if not messagebox.askyesno("删除参数列", f"删除“{parameter_title(key, self.catalog)}”及这一列填写的数值？"):
            return
        for row in self.table.get_children():
            values = list(self.table.item(row, "values"))
            del values[index]
            self.table.item(row, values=values, text="待运行")
        del self.parameter_columns[index - 2]
        self.active_column = min(index, len(self.parameter_columns) + 1)
        self._refresh_columns()
        self.column_info.config(text="参数列已删除；运行行和其他列保留。")
        self._update_summary()

    def fill_column(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        index = self.active_column
        if not 2 <= index < len(self.parameter_columns) + 2:
            messagebox.showinfo("选择参数列", "请先点击要填写的参数列标题。")
            return
        key = self.parameter_columns[index - 2]
        value = simpledialog.askstring("整列填值", f"将以下值填入所有 {len(self.table.get_children())} 行：\n{parameter_title(key, self.catalog)}\n留空表示沿用模型原值。", initialvalue=str(self.catalog[key].get("value", "")), parent=self.root)
        if value is None:
            return
        try:
            self._validate_value(key, value)
        except ValueError as exc:
            messagebox.showerror("数值不正确", str(exc))
            return
        for row in self.table.get_children():
            values = list(self.table.item(row, "values"))
            values[index] = value
            self.table.item(row, values=values, text="待运行")
        self.log(f"已填写整列：{parameter_title(key, self.catalog)}")

    def duplicate_rows(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        for row in self.table.selection():
            values = self.table.item(row, "values")
            self._insert_run_row(str(values[1]) + " - 副本", dict(zip(self.parameter_columns, values[2:])))
        self._update_summary()

    def _context_menu(self, event):
        self._remember_active_cell(event)
        menu = tk.Menu(self.root, tearoff=False)
        menu.add_command(label="添加参数列…", command=self.add_columns)
        menu.add_command(label="删除当前参数列", command=self.remove_column)
        menu.add_command(label="整列填值…", command=self.fill_column)
        menu.add_separator()
        menu.add_command(label="复制选中运行行", command=self.duplicate_rows)
        menu.add_command(label="粘贴表格", command=self.paste_table)
        menu.tk_popup(event.x_root, event.y_root)
        return "break"

    def scan_model_inputs(self):
        if self.is_running:
            messagebox.showinfo("提示", "请等待当前任务结束")
            return
        fn = filedialog.askopenfilename(title="打开 Aspen 模型", filetypes=[("Aspen model", "*.bkp")])
        if not fn:
            return
        self._set_busy(True)
        self.log("正在打开模型并读取可选参数，请稍候…")
        def worker():
            import pythoncom
            import win32com.client
            pythoncom.CoInitialize()
            aspen = None
            try:
                aspen = create_aspen_document()
                aspen.InitFromArchive2(fn)
                aspen.Visible = 0
                aspen.SuppressDialogs = 1
                catalog = discover_parameters(aspen)
                if not catalog:
                    raise ValueError("未找到可读取的输入参数")
                self.root.after(0, lambda: self._accept_scan(Path(fn), catalog))
            except Exception as exc:
                self.root.after(0, lambda e=str(exc): messagebox.showerror("扫描失败", e))
            finally:
                try:
                    if aspen is not None:
                        aspen.Close(False)
                finally:
                    pythoncom.CoUninitialize()
                    self.root.after(0, self._scan_finished)
        threading.Thread(target=worker, daemon=True).start()

    def _scan_finished(self):
        self._set_busy(False)

    def _accept_scan(self, model, catalog):
        if self.model_path is not None and Path(self.model_path) != model:
            self._clear_table()
        self.model_path = model
        # Keep legacy aliases for existing rows when scanning the same model.
        legacy = legacy_catalog(getattr(self.control_module, "BLOCKS_CONFIG", {}))
        paths = {spec["path"] for spec in catalog.values()}
        for key, spec in legacy.items():
            if key in self.parameter_columns and spec["path"] in paths:
                catalog[key] = spec
        self.catalog = catalog
        self.control_module = SimpleNamespace(BLOCKS_CONFIG={}, STREAMS_CONFIG=[])
        self.model_label.config(text=f"当前模型：{model.name}   ·   可添加设备和物流的参数列", foreground="black")
        self._refresh_columns()
        self.log(f"模型已打开：{len(catalog)} 个输入候选。点击“添加参数列”选择需要控制的参数。")
        self.log("每行运行一次，空白参数沿用原始模型值。")

    def _ensure_parameter_column(self, key):
        if key in self.parameter_columns:
            return
        self.parameter_columns.append(key)
        self._refresh_columns()
        for row in self.table.get_children():
            values = list(self.table.item(row, "values"))
            values.append("")
            self.table.item(row, values=values)
        self._update_summary()

    def _insert_run_row(self, name, params):
        # 按当前动态参数列顺序插入一行。
        for key in params:
            self._ensure_parameter_column(key)
        n = len(self.table.get_children()) + 1
        values = [n, name]
        values.extend(params.get(key, "") for key in self.parameter_columns)
        item = self.table.insert("", tk.END, text="待运行", values=values, tags=("even",) if n % 2 == 0 else ())
        # 新增后选中该行，方便继续编辑或复制。
        self.table.selection_set(item)
        self.table.focus(item)
        self._update_summary()
        return item

    def _show_scan_dialog(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        if not self.catalog:
            messagebox.showerror("先打开模型", "请先打开 Aspen 模型或已有运行表。")
            return
        baseline = {}
        selected = self.table.selection()
        if selected:
            vals = self.table.item(selected[0], "values")
            baseline = {key: vals[i] for i, key in enumerate(self.parameter_columns, 2)
                        if i < len(vals) and vals[i] != ""}
        dlg = MultiScanDialog(self.root, {key: self.catalog[key] for key in self.parameter_columns if key in self.catalog} or self.catalog, baseline)
        start = len(self.table.get_children())
        for i, case in enumerate(dlg.result_cases, start + 1):
            self._insert_run_row(f"运行{i}", case)
        if dlg.result_cases:
            self.log(f"已新增 {len(dlg.result_cases)} 行，每行运行一次")

    # ------------------------------------------------------------------
    # 脚本加载
    # ------------------------------------------------------------------

    def load_script(self):
        if self.is_running:
            return
        fn = filedialog.askopenfilename(
            title="选择控制脚本",
            filetypes=[("Python", "*_control.py"), ("All", "*.*")]
        )
        if not fn:
            return

        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("mod", fn)
            if not spec or not spec.loader:
                raise ImportError("无法加载")

            self.control_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.control_module)
            self._clear_table()
            self.model_path = self.control_module.MODEL_PATH
            self.catalog = legacy_catalog(self.control_module.BLOCKS_CONFIG)

            self.model_label.config(text=f"已加载: {Path(fn).name}", foreground="black")
            self.log(f"✓ 加载成功: {Path(fn).name}")
            self._refresh_columns()
        except Exception as e:
            messagebox.showerror("错误", f"加载失败:\n{e}")
            self.log(f"✗ 错误: {e}")

    def add_row(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        n = len(self.table.get_children()) + 1
        self._insert_run_row(f"运行{n}", {})

    def del_row(self):
        if self.is_running:
            return
        if not self._finish_edit():
            return
        sel = self.table.selection()
        if not sel:
            messagebox.showwarning("提示", "请选择要删除的行")
            return
        for item in sel:
            self.table.delete(item)
        self._renumber_rows()
        self.log(f"删除 {len(sel)} 行")

    def _clear_table(self):
        """不带确认的清空（供内部调用）。"""
        for item in self.table.get_children():
            self.table.delete(item)
        self.parameter_columns.clear()
        self._finish_edit(cancel=True)
        self.active_column = 1
        self._refresh_columns()
        self._update_summary()

    def clear_all(self):
        if self.is_running:
            return
        if not messagebox.askyesno("确认", "清空所有配置?"):
            return
        self._clear_table()
        self.log("已清空")

    def _remember_active_cell(self, event):
        col = self.table.identify_column(event.x)
        row = self.table.identify_row(event.y)
        if col and int(col[1:]) >= 2:
            self.active_column = int(col[1:]) - 1
            if self.active_column >= 2:
                key = self.parameter_columns[self.active_column - 2]
                self.column_info.config(text=parameter_detail(key, self.catalog) if key in self.catalog else key)
        if getattr(event, "num", None) == 3 and row and row not in self.table.selection():
            self.table.selection_set(row)
            self.table.focus(row)

    def _paste_event(self, event=None):
        self.paste_table()
        return "break"

    def _copy_event(self, event=None):
        self.copy_table()
        return "break"

    def _delete_cells(self, event=None):
        if not self.is_running:
            for row in self.table.selection():
                values = list(self.table.item(row, "values"))
                if 1 <= self.active_column < len(values):
                    values[self.active_column] = ""
                    self.table.item(row, values=values, text="待运行")
        return "break"

    def _table_columns(self):
        return ["行号", "运行名称", *self.parameter_columns]

    def _header_key(self, name):
        name = name.strip().replace("\n", " ")
        if name in ("行号", "序号"):
            return "__index__"
        if name in ("运行名称", "名称"):
            return "__name__"
        if name in self.catalog:
            return name
        matches = [key for key in self.catalog if name in
                   (parameter_title(key, self.catalog), column_title(key, self.catalog).replace("\n", " "))]
        current = [key for key in self.parameter_columns if key in matches]
        if len(current) == 1:
            return current[0]
        if matches and len({self.catalog[key]["path"] for key in matches}) == 1:
            return matches[0]
        return matches[0] if len(matches) == 1 else None

    def paste_table(self):
        if self.is_running or not self._finish_edit():
            return
        try:
            text = self.root.clipboard_get()
            count = self.paste_text(text)
            if count:
                self.log(f"已粘贴 {count} 行。")
        except (tk.TclError, ValueError) as exc:
            messagebox.showerror("无法粘贴", str(exc))

    def paste_text(self, text):
        matrix = list(csv.reader(io.StringIO(text), delimiter="\t"))
        while matrix and not any(matrix[-1]):
            matrix.pop()
        if not matrix:
            return 0
        first = [cell.strip() for cell in matrix[0]]
        keys = [self._header_key(cell) for cell in first]
        has_header = any(key is not None for key in keys)
        planned = list(self.parameter_columns)
        if has_header:
            if any(len(row) > len(keys) for row in matrix[1:]):
                raise ValueError("部分数据行比表头多出列，请检查 Excel 复制区域。")
            if any(key is None for key in keys):
                bad = [name for name, key in zip(first, keys) if key is None]
                raise ValueError("无法识别表头：" + "、".join(bad) + "。请先添加对应参数列，或使用复制表格生成的表头。")
            if len(set(keys)) != len(keys):
                raise ValueError("表头重复，请每个参数只保留一列。")
            for key in keys:
                if key not in ("__index__", "__name__") and key not in planned:
                    planned.append(key)
            destination = ["__index__", "__name__", *planned]
            mapping = [(destination.index(key), i) for i, key in enumerate(keys) if key != "__index__"]
            matrix = matrix[1:]
        else:
            width = max(map(len, matrix))
            if self.active_column + width > len(planned) + 2:
                raise ValueError("粘贴区域超过现有参数列。请先点击“添加参数列”，再从目标单元格粘贴。")
            mapping = [(self.active_column + i, i) for i in range(width)]
        paths = [self.catalog[key]["path"] for key in planned if key in self.catalog]
        if len(paths) != len(set(paths)):
            raise ValueError("表格中的两个参数指向同一项 Aspen 设置，请去掉重复列。")
        for row_number, source in enumerate(matrix, 1):
            for dest, src in mapping:
                if dest >= 2 and src < len(source):
                    try:
                        self._validate_value(planned[dest-2], source[src])
                    except ValueError as exc:
                        raise ValueError(f"粘贴数据第 {row_number} 行：{exc}") from exc
        # Validate before changing table structure or values.
        for key in planned:
            self._ensure_parameter_column(key)
        rows = list(self.table.get_children())
        selection = self.table.selection()
        start = rows.index(selection[0]) if selection else len(rows)
        for offset, source in enumerate(matrix):
            if start + offset >= len(rows):
                rows.append(self._insert_run_row(f"运行{len(rows)+1}", {}))
            row = rows[start+offset]
            values = list(self.table.item(row, "values"))
            for dest, src in mapping:
                if src < len(source):
                    values[dest] = source[src].strip()
            self.table.item(row, values=values, text="待运行")
        self._renumber_rows()
        return len(matrix)

    def copy_table(self):
        if not self._finish_edit():
            return
        selected = self.table.selection()
        if not selected:
            messagebox.showinfo("选择运行行", "请先选择要复制的行，可按 Ctrl 或 Shift 多选。")
            return
        output = io.StringIO()
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["运行名称", *(column_title(key, self.catalog).replace("\n", " ") for key in self.parameter_columns)])
        for row in selected:
            writer.writerow(self.table.item(row, "values")[1:])
        self.root.clipboard_clear()
        self.root.clipboard_append(output.getvalue())
        self.log(f"已复制 {len(selected)} 行，可粘贴到 Excel 或本表。")

    def _renumber_rows(self):
        for index, row in enumerate(self.table.get_children(), 1):
            values = list(self.table.item(row, "values"))
            values[0] = index
            self.table.item(row, values=values, tags=("even",) if index % 2 == 0 else ())
        self._update_summary()

    def _validate_value(self, key, value):
        if not str(value).strip():
            return
        if key not in self.catalog:
            raise ValueError(f"参数不存在：{key}，请重新打开模型。")
        try:
            coerce_value(value, self.catalog[key].get("value"))
        except ValueError as exc:
            raise ValueError(f"{parameter_title(key, self.catalog)}：{exc}") from exc

    def edit_cell(self, event):
        if self.table.identify("region", event.x, event.y) != "cell":
            return
        row = self.table.identify_row(event.y)
        index = int(self.table.identify_column(event.x)[1:]) - 1
        self._begin_edit(row, index)

    def _edit_selected(self, event=None):
        rows = self.table.selection()
        if rows:
            self._begin_edit(rows[0], self.active_column)
        return "break"

    def _begin_edit(self, row, index):
        if self.is_running or not row or not 1 <= index < len(self.parameter_columns) + 2:
            return
        if not self._finish_edit():
            return
        self.table.see(row)
        self.root.update_idletasks()
        box = self.table.bbox(row, f"#{index+1}")
        if not box:
            return
        x, y, width, height = box
        values = self.table.item(row, "values")
        self.active_column = index
        self._edit_location = (row, index)
        self.editor = ttk.Entry(self.table)
        self.editor.place(x=x, y=y, width=width, height=height)
        self.editor.insert(0, values[index])
        self.editor.select_range(0, "end")
        self.editor.focus_set()
        self.editor.bind("<Return>", lambda e: self._navigate_edit(1, 0))
        self.editor.bind("<Tab>", lambda e: self._navigate_edit(0, 1))
        self.editor.bind("<Shift-Tab>", lambda e: self._navigate_edit(0, -1))
        self.editor.bind("<Escape>", lambda e: self._finish_edit(cancel=True))
        self.editor.bind("<FocusOut>", lambda e: self._finish_edit())

    def _finish_edit(self, cancel=False):
        if self.editor is None:
            return True
        entry = self.editor
        row, index = self._edit_location
        value = entry.get().strip()
        if not cancel and index >= 2:
            try:
                self._validate_value(self.parameter_columns[index-2], value)
            except ValueError as exc:
                self.column_info.config(text=str(exc), foreground="#b42318")
                entry.focus_set()
                return False
        self.editor = None
        self._edit_location = None
        if not cancel and self.table.exists(row):
            values = list(self.table.item(row, "values"))
            values[index] = value
            self.table.item(row, values=values, text="待运行")
        entry.destroy()
        self.column_info.configure(foreground="#536479")
        return True

    def _navigate_edit(self, dr, dc):
        row, index = self._edit_location
        rows = list(self.table.get_children())
        row_index = rows.index(row) + dr
        col = index + dc
        if not self._finish_edit():
            return "break"
        if col >= len(self.parameter_columns) + 2:
            col, row_index = 1, row_index + 1
        if col < 1:
            col, row_index = len(self.parameter_columns) + 1, row_index - 1
        if 0 <= row_index < len(rows):
            self._begin_edit(rows[row_index], col)
        else:
            self.table.focus_set()
        return "break"

    def _collect_cases(self):
        cases, names = [], []
        for number, row in enumerate(self.table.get_children(), 1):
            values = self.table.item(row, "values")
            parameters = {}
            for key, value in zip(self.parameter_columns, values[2:]):
                self._validate_value(key, value)
                if str(value).strip():
                    parameters[key] = value
            cases.append(parameters)
            names.append(str(values[1]).strip() or f"运行{number}")
        return cases, names

    def start(self):
        if self.is_running or not self._finish_edit():
            return
        if not self.control_module or self.model_path is None:
            messagebox.showinfo("先打开模型", "请先打开 Aspen 模型或已保存的运行表。")
            return
        if not self.model_path.exists():
            messagebox.showerror("模型不存在", f"找不到模型：{self.model_path}\n请重新打开实际模型。")
            return
        try:
            param_sets, run_names = self._collect_cases()
        except ValueError as exc:
            messagebox.showerror("请检查表格", str(exc))
            return
        if not param_sets:
            messagebox.showinfo("添加运行行", "每行代表一次运行，请至少添加一行。")
            return
        self.stop_requested = False
        self.run_row_ids = list(self.table.get_children())
        for row in self.run_row_ids:
            self.table.item(row, text="等待中")
        self._set_busy(True)
        self.stop_btn.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log(f"开始执行 {len(param_sets)} 行；每行设置 {len(self.parameter_columns)} 列参数，空白沿用原模型。")
        threading.Thread(target=self.run_thread, args=(param_sets, run_names), daemon=True).start()

    def _row_status(self, index, text):
        if 1 <= index <= len(self.run_row_ids):
            row = self.run_row_ids[index-1]
            if self.table.exists(row):
                self.table.item(row, text=text)

    def _run_finished(self):
        self._set_busy(False)
        self.stop_btn.config(state="disabled")
        for row in self.run_row_ids:
            if self.table.exists(row) and self.table.item(row, "text") == "等待中":
                self.table.item(row, text="未运行")

    def run_thread(self, param_sets, run_names):
        try:
            if self.model_path is None or self.control_module is None:
                raise RuntimeError("请先打开模型或运行表")

            self.runner = BatchRunner(
                self.model_path,
                self.control_module.BLOCKS_CONFIG,
                self.control_module.STREAMS_CONFIG,
                self.catalog.copy(),
            )

            total = len(param_sets)
            self.root.after(0, lambda: self.progress.configure(maximum=total, value=0))

            for i, (ps, rn) in enumerate(zip(param_sets, run_names), start=1):
                if self.stop_requested:
                    self.root.after(0, lambda: self.log("已停止"))
                    break

                self.root.after(0, lambda _i=i, _rn=rn: self.log(f"\n[{_i}/{total}] {_rn}"))
                self.root.after(0, lambda _i=i: self.progress.configure(value=_i - 1))
                self.root.after(0, lambda _i=i: self.prog_label.configure(
                    text=f"{_i - 1}/{total}"))

                self.root.after(0, lambda idx=i: self._row_status(idx, "运行中"))
                result = self.runner.run_single(ps, i, rn)
                status_text = "已导出" if result["status"] == "success" else "失败"
                self.root.after(0, lambda idx=i, text=status_text: self._row_status(idx, text))
                # GUI 逐次调用 run_single，不走 run_batch，因此必须手动累计结果。
                self.runner.batch_results.append(result)

                if result["status"] == "success":

                    t = result.get("elapsed_time_seconds", 0)
                    self.root.after(0, lambda _t=t: self.log(f"✓ 成功 ({_t}秒)"))
                else:
                    err = result.get("error", "未知")
                    self.root.after(0, lambda _e=err: self.log(f"✗ 失败: {_e}"))

                self.root.after(0, lambda _i=i: self.progress.configure(value=_i))
                self.root.after(0, lambda _i=i: self.prog_label.configure(
                    text=f"{_i}/{total}"))

            if self.runner.batch_results:
                self.root.after(0, lambda: self.log("\n正在保存汇总..."))
                jp, cp, bd = self.runner.save_batch_summary()
                self.root.after(0, lambda _bd=bd: self.log(f"✓ 已保存到: {_bd}"))
                sc = sum(1 for r in self.runner.batch_results if r["status"] == "success")
                self.root.after(0, lambda _sc=sc, _bd=bd: messagebox.showinfo(
                    "完成", f"批处理完成!\n\n成功: {_sc}/{total}\n\n结果: {_bd}"))

        except Exception as e:
            self.root.after(0, lambda _e=e: self.log(f"\n✗ 错误: {_e}"))
            self.root.after(0, lambda _e=e: messagebox.showerror("错误", str(_e)))
        finally:
            self.root.after(0, self._run_finished)

    def stop(self):
        self.stop_requested = True
        self.stop_btn.configure(state="disabled")
        self.log("将在当前行完成后停止，已完成结果会保存。")

    def save_cfg(self):
        if self.is_running or not self._finish_edit():
            return
        if self.model_path is None:
            messagebox.showinfo("先打开模型", "请先打开 Aspen 模型。")
            return
        try:
            cases, names = self._collect_cases()
        except ValueError as exc:
            messagebox.showerror("请检查表格", str(exc))
            return
        fn = filedialog.asksaveasfilename(title="保存运行表", defaultextension=".json", filetypes=[("运行表", "*.json")])
        if not fn:
            return
        cfg = {"model_path": str(self.model_path), "parameter_catalog": self.catalog,
               "parameter_columns": self.parameter_columns,
               "parameter_sets": [{"_name": name, "parameters": case} for name, case in zip(names, cases)]}
        Path(fn).write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        self.log(f"运行表已保存：{fn}")

    def load_cfg(self):
        if self.is_running:
            return
        fn = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not fn:
            return

        try:
            cfg = json.loads(Path(fn).read_text(encoding="utf-8"))

            if cfg.get("parameter_catalog"):
                module = SimpleNamespace(BLOCKS_CONFIG={}, STREAMS_CONFIG=[])
                catalog = cfg["parameter_catalog"]
            else:
                import importlib.util
                cs = Path(cfg["control_script"])
                if not cs.is_absolute():
                    cs = Path(fn).parent / cs
                spec = importlib.util.spec_from_file_location("mod", cs)
                if spec is None or spec.loader is None:
                    raise ValueError("无法加载配置引用的控制脚本")
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                catalog = legacy_catalog(module.BLOCKS_CONFIG)
            self.control_module = module
            self.catalog = catalog
            self.model_path = Path(cfg["model_path"])
            self.model_label.config(text=f"已加载: {self.model_path.name}", foreground="black")
            self._refresh_columns()

            # 直接清空，不弹确认（用户选文件时已做出决定）
            self._clear_table()

            for key in cfg.get("parameter_columns", []):
                self._ensure_parameter_column(key)
            for idx, pset in enumerate(cfg["parameter_sets"], start=1):
                name = pset.get("_name", f"运行{idx}")
                params = pset["parameters"]
                for key in params:
                    self._ensure_parameter_column(key)
                self._insert_run_row(name, params)

            self.log(f"✓ 已加载: {fn}")
            messagebox.showinfo("成功", f"已加载 {len(cfg['parameter_sets'])} 行运行计划")

        except Exception as e:
            messagebox.showerror("错误", f"加载失败:\n{e}")
            self.log(f"✗ 错误: {e}")

    def open_folder(self):
        if not self.runner or self.model_path is None:
            messagebox.showinfo("提示", "尚未运行批处理")
            return
        model_dir = Path(__file__).resolve().parent / "outputdata" / self.runner.model_path.stem
        folder = model_dir / f"batch_{self.runner.batch_id}"
        # 汇总目录可能尚未生成；此时至少打开实际生成的单次结果目录。
        if not folder.exists():
            candidates = sorted(
                (p for p in model_dir.glob("*") if p.is_dir() and not p.name.startswith("batch_")),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            ) if model_dir.exists() else []
            folder = candidates[0] if candidates else model_dir
        if not folder.exists():
            messagebox.showinfo("提示", f"输出文件夹不存在：{model_dir}")
            return

        import subprocess
        import platform

        sys_name = platform.system()
        if sys_name == "Windows":
            subprocess.Popen(f'explorer "{folder}"')
        elif sys_name == "Darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])


def main():
    root = tk.Tk()
    app = BatchRunnerGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
