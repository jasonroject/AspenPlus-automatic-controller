from pathlib import Path
p=Path('extrudecad-web/src/App.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace("shape.locked ? '解锁' : '锁定'}", "t(shape.locked ? '解锁' : '锁定')}")
s=s.replace("shape.visible ? '隐藏' : '显示'}", "t(shape.visible ? '隐藏' : '显示')}")
p.write_text(s,encoding='utf-8')
p=Path('extrudecad-web/src/components/BottomControlDock.tsx')
s=p.read_text(encoding='utf-8').replace('!h-10 !w-9 !px-0 flex-col', '!h-10 flex-col')
p.write_text(s,encoding='utf-8')
