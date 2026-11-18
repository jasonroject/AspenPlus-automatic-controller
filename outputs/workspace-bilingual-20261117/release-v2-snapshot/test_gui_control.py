"""Hidden-window checks for multi-device table and configuration round trips."""
import json
import tempfile
import tkinter as tk
import unittest
from pathlib import Path
from unittest.mock import patch

from batch_gui import BatchRunnerGUI
from scan_dialog import MultiScanDialog
from column_picker import ColumnPicker
from parameter_labels import column_title


class GuiTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.app = BatchRunnerGUI(self.root)
        self.catalog = {
            f"Blocks.{owner}.TEMP": dict(path=f"\\Data\\Blocks\\{owner}\\Input\\TEMP",
                section="Blocks", owner=owner, label="TEMP", value=603, unit="K")
            for owner in ("REACTOR", "HEATER")}
        self.app._accept_scan(Path("test.bkp"), self.catalog)

    def tearDown(self):
        self.root.destroy()

    def test_config_roundtrip(self):
        self.app._insert_run_row("joint", {key: 608 for key in self.catalog})
        with tempfile.TemporaryDirectory() as tmp:
            file = str(Path(tmp) / "config.json")
            with patch("batch_gui.filedialog.asksaveasfilename", return_value=file), patch("batch_gui.messagebox.showinfo"):
                self.app.save_cfg()
            cfg = json.loads(Path(file).read_text(encoding="utf-8"))
            self.assertEqual(len(cfg["parameter_sets"][0]["parameters"]), 2)
            with patch("batch_gui.filedialog.askopenfilename", return_value=file), patch("batch_gui.messagebox.showinfo"):
                self.app.load_cfg()
            self.assertEqual(len(self.app.parameter_columns), 2)
            self.assertEqual(len(self.app.table.get_children()), 1)
        with patch.object(ColumnPicker, "wait_window", lambda self: None):
            picker = ColumnPicker(self.root, self.catalog)
            picker.query.set("HEATER")
            self.assertEqual(len(picker.item_keys), 1)
            item = next(iter(picker.item_keys))
            picker.tree.focus(item)
            picker.toggle()
            picker.confirm()
            self.assertEqual(picker.selected_keys, ["Blocks.HEATER.TEMP"])

    def test_add_remove_columns_preserves_rows(self):
        self.app.add_row()
        self.app.add_row()
        self.app.add_parameter_columns(list(self.catalog))
        rows = self.app.table.get_children()
        self.assertEqual(len(rows), 2)
        self.assertEqual(self.app.table.item(rows[0], "values")[2:], ("", ""))
        self.app.table.item(rows[0], values=(1, "A", 603, 608))
        self.app.active_column = 2
        with patch("batch_gui.messagebox.askyesno", return_value=True):
            self.app.remove_column()
        self.assertEqual(self.app.parameter_columns, ["Blocks.HEATER.TEMP"])
        self.assertEqual(self.app.table.item(rows[0], "values"), ("1", "A", "608"))
        self.assertEqual(len(self.app._collect_cases()[0]), 2)

    def test_duplicate_row_and_fill_column(self):
        self.app.add_parameter_columns(list(self.catalog))
        self.app.active_column = 2
        with patch("batch_gui.simpledialog.askstring", return_value="608"):
            self.app.fill_column()
        self.app.duplicate_rows()
        cases, _ = self.app._collect_cases()
        self.assertEqual(cases, [{"Blocks.REACTOR.TEMP": "608"}] * 2)

    def test_blank_rows_and_columns_saved(self):
        self.app.add_parameter_columns(list(self.catalog))
        self.app.add_row()
        self.assertEqual(self.app._collect_cases()[0], [{}, {}])
        with tempfile.TemporaryDirectory() as tmp:
            file = str(Path(tmp) / "config.json")
            with patch("batch_gui.filedialog.asksaveasfilename", return_value=file):
                self.app.save_cfg()
            data = json.loads(Path(file).read_text(encoding="utf-8"))
            self.assertEqual(data["parameter_columns"], list(self.catalog))
            self.assertEqual(len(data["parameter_sets"]), 2)
            self.app._clear_table()
            with patch("batch_gui.filedialog.askopenfilename", return_value=file), patch("batch_gui.messagebox.showinfo"):
                self.app.load_cfg()
            self.assertEqual(self.app._collect_cases()[0], [{}, {}])
            self.assertEqual(self.app.parameter_columns, list(self.catalog))

    def test_paste_friendly_headers_and_invalid_data(self):
        header = column_title("Blocks.REACTOR.TEMP", self.catalog).replace("\n", " ")
        self.app.paste_text(f"运行名称\t{header}\nA\t603\nB\t608")
        self.assertEqual(self.app._collect_cases()[0], [
            {"Blocks.REACTOR.TEMP": "603"}, {"Blocks.REACTOR.TEMP": "608"}])
        with self.assertRaises(ValueError):
            self.app.paste_text("运行名称\t未知参数\nA\t123")
        with self.assertRaises(ValueError):
            self.app.paste_text(f"运行名称\t{header}\nA\tNaN")
        self.assertEqual(len(self.app.table.get_children()), 2)
        self.app.active_column = 2
        with self.assertRaises(ValueError):
            self.app.paste_text("1\t2")

    def test_busy_table_cannot_change(self):
        self.app.add_parameter_columns(list(self.catalog))
        self.app._set_busy(True)
        self.app.add_row()
        self.app.del_row()
        self.app.add_parameter_columns(list(self.catalog))
        self.app.remove_column()
        self.assertEqual(len(self.app.table.get_children()), 1)
        self.assertEqual(len(self.app.parameter_columns), 2)

    def test_editor_navigation_and_validation(self):
        self.root.deiconify()
        self.app.add_parameter_columns(list(self.catalog))
        self.root.update()
        row = self.app.table.get_children()[0]
        self.app._begin_edit(row, 2)
        self.assertIsNotNone(self.app.editor)
        self.app.editor.insert(0, "NaN")
        self.assertFalse(self.app._finish_edit())
        self.app.editor.delete(0, "end")
        self.app.editor.insert(0, "608")
        self.app._navigate_edit(0, 1)
        self.assertEqual(self.app._edit_location, (row, 3))
        self.assertEqual(self.app.table.item(row, "values")[2], "608")
        self.app._finish_edit(cancel=True)

    def test_small_window_keeps_run_controls_visible(self):
        self.root.deiconify()
        self.root.geometry("1040x720")
        self.root.update()
        self.root.after(50, self.root.quit)
        self.root.mainloop()
        self.root.update()
        for widget in (self.app.run_btn, self.app.log_text):
            self.assertTrue(widget.winfo_ismapped())
            self.assertLessEqual(widget.winfo_rooty() - self.root.winfo_rooty() + widget.winfo_height(), self.root.winfo_height())
        with patch.object(MultiScanDialog, "wait_window", lambda self: None):
            dialog = MultiScanDialog(self.root, self.catalog)
            dialog.geometry("790x570")
            dialog.update()
            dialog.after(50, dialog.quit)
            dialog.mainloop()
            self.assertTrue(dialog.preview.winfo_ismapped())
            self.assertGreater(dialog.preview.winfo_width(), 20)
            self.assertLessEqual(dialog.preview.winfo_y() + dialog.preview.winfo_height(), dialog.winfo_height())
            dialog.destroy()

    def test_joint_dialog_and_baseline(self):
        with patch.object(MultiScanDialog, "wait_window", lambda self: None):
            dialog = MultiScanDialog(self.root, self.catalog, {"fixed": 25})
            dialog.rules = {key: [603, 608] for key in self.catalog}
            dialog.confirm()
            self.assertEqual(len(dialog.result_cases), 2)
            self.assertEqual(dialog.result_cases[1], {
                "fixed": 25, "Blocks.REACTOR.TEMP": 608, "Blocks.HEATER.TEMP": 608})


if __name__ == "__main__":
    unittest.main()
