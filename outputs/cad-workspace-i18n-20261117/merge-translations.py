import json,re
from pathlib import Path
base=Path('outputs/cad-workspace-i18n-20261117');result={}
for n in range(1,5):result.update(json.loads((base/f'en-{n}.json').read_text(encoding='utf8')))
result.pop('.header-actions, .view-switch, .model-sidebar, .inspector, [aria-label="CAD绘图工具栏"]',None)
result.update({'界面语言':'Interface language','切换网格显示':'Toggle grid display','F7 · 网格显示':'F7 · Grid display','网格显示':'Grid display','属性面板':'Properties panel','命令输入栏':'Command line','移动 / 旋转 / 缩放':'Move / Rotate / Scale','复制 / 删除':'Copy / Erase','两点测量 DI↵ · XY平面距离':'Measure DI ↵ · XY distance','Z↵ 适合视图':'Z ↵ Fit view','二维':'2D','三维':'3D','显示 / 隐藏属性面板':'Show / hide Properties','退出清屏 · Ctrl+0':'Exit clean screen · Ctrl+0','清屏编辑':'Clean screen','工作区视图':'Workspace views','双视图':'Split','模型':'Model','草图':'Sketch','选项':'Options','已选':'Selected','关':'Off','开':'On'})
old=next(k for k in result if 'L 是立即启动的快捷键' in k)
new=old.replace('L 是立即启动的快捷键，无须再按回车确认命令名。','在空闲画布输入命令别名并按回车执行，例如 L、REC、C、PO；M 移动，DI 测量。')
result[new]='Use U then Enter to undo a drawing step, and C then Enter to close a chain or polygon. Empty Enter/Space or right-click finishes drawing; Esc cancels the draft and keeps committed segments. Enter/Space repeats the last drawing command; another empty Enter at the LINE start prompt continues from the last surviving endpoint. From an idle canvas, type an alias and press Enter: L, REC, C, PO, M (Move), or DI (Distance). Pan with the middle button or Alt+left drag; zoom with the wheel or view controls.'
(Path('extrudecad-web/src/locales/en.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
remaining=[(k,v) for k,v in result.items() if re.search(r'[\u3400-\u9fff]',v)]
print('entries',len(result),'English values containing Han',remaining)
