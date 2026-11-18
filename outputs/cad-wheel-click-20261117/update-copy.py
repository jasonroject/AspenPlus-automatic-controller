from pathlib import Path
root = Path(r'C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\extrudecad-web')
replacements = {
 'src/App.tsx': {
  'Enter / 空格重复绘图 · 中键平移': '单击空白取消选择 · 拖动框选 · 滚轮缩放',
  '左键旋转 · 右键平移 · 上方按钮缩放': '左键旋转 · 右键平移 · 滚轮缩放',
  '中键或 Alt + 左键拖动平移，上方按钮缩放。': '中键或 Alt + 左键拖动平移，编辑视图内滚轮缩放，也可使用上方按钮或百分比。',
  '空白处可按住拖框，也可轻点第一角、移动后再点对角。': '单击空白处取消选择；按住左键拖动才出现选框，松手完成。',
  '等待对角点时Esc或右键取消本次框选并保留原选择；空闲时Esc清空选择。': '拖框时Esc或右键取消本次框选并保留原选择；空闲时Esc清空选择。',
 },
 'src/components/Inspector.tsx': {'空白处拖框或点两角':'按住空白处拖动'},
 'src/components/WorkspaceOptions.tsx': {
  '用每个视图上方的 − / ＋、百分比输入、100% 或“适合”控制。滚轮不缩放画布，Ctrl + 滚轮不缩放页面；列表和属性面板仍可正常滚动。':'在二维或三维编辑视图内滚动鼠标，以鼠标位置为中心缩放图形。也可使用上方 − / ＋、百分比、100% 或“适合”。视图外滚轮不缩放界面，Ctrl + 滚轮不会缩放整个页面；列表和属性面板仍可正常滚动。',
 },
 'README.md': {
  '二维空白处支持拖框和轻点两角框选：':'二维单击空白处取消选择，按住拖动才框选：',
  '待第二角时 Esc / 右键取消本次框选并保留原选择':'拖框时 Esc / 右键取消本次框选并保留原选择',
  '滚轮不缩放画布，Ctrl+滚轮不缩放页面；列表仍可滚动。':'编辑画布内滚轮以鼠标位置为中心缩放图形，面板外观保持固定；Ctrl+滚轮也不会缩放整个页面，列表仍可滚动。',
  '本轮补充两击框选、实时追加/减选预览和白色选框；修复选择提示遮挡及修饰键选择边线的问题。新增选择实测与续画/夹点回归共 57 项通过，见':'上一轮验证白色选框、追加/减选预览、提示遮挡和修饰键选择边线，共 57 项实测记录见',
  '及 128 项自动测试通过':'及 131 项自动测试通过',
 }
}
for name, pairs in replacements.items():
 p=root/name
 text=p.read_text(encoding='utf-8')
 for old,new in pairs.items():
  assert old in text, (name,old)
  text=text.replace(old,new)
 p.write_text(text,encoding='utf-8')
