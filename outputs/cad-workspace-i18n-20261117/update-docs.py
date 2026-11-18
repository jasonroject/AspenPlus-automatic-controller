from pathlib import Path
p=Path('extrudecad-web/README.md')
s=p.read_text(encoding='utf-8')
s=s.replace('中文轻量 CAD 网页工作台','支持中文/English 的轻量 CAD 网页工作台')
s=s.replace('底部「点线」或 L：','底部「点线」或 L↵：')
s=s.replace('按 `M` 进入 XY 测量','输入 `DI` 后回车进入 XY 测量').replace('按 `F` 找回全部可见构件','输入 `Z` 后回车找回全部可见构件')
s=s.replace('`V/L/R/C/P/M` 分别为选择、点线一体、矩形、圆、多边形、测量','`V/L/REC/C/PL/DI` 后回车分别为选择、点线一体、矩形、圆、多边形、测量；`M/RO/SC` 后回车打开移动/旋转/缩放面板')
s=s.replace('及 131 项自动测试通过','及 135 项自动测试通过')
insert='''## 快捷键、清屏与语言

右侧属性栏标题右边可收起/展开，快捷键 `Ctrl+1`。`Ctrl+0` 进入或退出清屏编辑，保留画布、命令行和退出入口，并记住进入前的侧栏开关。`Ctrl+9` 显示/隐藏命令行。顶栏「选项」可切换中文/English，刷新保留；图纸中的对象名称不随语言改变。

空闲时输入命令别名，再按回车或空格执行：`L` 点线、`REC` 矩形、`C` 圆、`PO` 点、`M` 移动、`CO` 复制、`RO` 旋转、`SC` 缩放、`E` 删除、`DI` 测距、`Z` 适合视图。`F1` 查看应用内帮助；`F3/F7/F8/F9` 分别控制捕捉、网格显示、正交和网格吸附。M 不再是测量快捷键。完整用法、与 AutoCAD 的差异和本轮 60 项 Ego 检查见 [验证记录](deliverables/CAD_快捷键清屏与双语验证_20261117.md)。

'''
s=s.replace('## 精确建模与文件交换',insert+'## 精确建模与文件交换')
p.write_text(s,encoding='utf-8')
p=Path('extrudecad-web/QA.md')
s=p.read_text(encoding='utf-8')
addition='''## Command aliases, collapsible inspector, clean screen and localization

- Added Enter/Space-executed CAD aliases, F1 help, F7 grid display, Ctrl+1 inspector, Ctrl+0 clean screen and Ctrl+9 command line. M now opens Move; DI starts measurement. Clean screen restores prior side-panel state. Chinese/English is persistent and presentation-only.
- Reproduced and fixed Esc arbitration in the transform panel: capture-phase cancellation now closes the active panel before global selection handling. Rapid REC entry retains all letters; command-field Ctrl+A does not select model objects. Repaired narrow English header clipping, untranslated material labels and overlapping toolbar labels.
- 60 Ego checks passed: layout 5, language 5, aliases 7, selection 9, 2D wheel 7, drafting/grip wheel 4, core grips 11, clean-screen workflow 6, final English layout/editing 4, final layout/restoration 2. Evidence: `../outputs/cad-workspace-i18n-20261117/checks-*.json`; zoom checks are under its `checks` property. Intermediate failed assertions remain for traceability; reload selects the first restored object by existing design, so final selection was explicitly cleared.
- 135 automated tests, TypeScript and production/standalone build passed. Nonblocking bundle-size warning remains. Native viewport plus 1366×850 and 390×844 desktop emulation were used; no mobile touch, native AutoCAD or direct file:// execution was claimed.
- Restored all 48 original objects and compared every shape field against the fresh pre-task backup. Final language Chinese, compact panels, left tree collapsed, right inspector available, sketch view and no selection. Served HTML exactly matches deliverable; SHA256 `58e12190b2fa161fb36cb3a267e43b989cf229741363376fe3b8c9d5bdb069b6`.
- Details and supported command boundaries: `deliverables/CAD_快捷键清屏与双语验证_20261117.md`. Earlier immediate-letter shortcuts and M-for-measure guidance are superseded.

'''
s=s.replace('## User correction:',addition+'## User correction:',1)
p.write_text(s,encoding='utf-8')
