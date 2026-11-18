from pathlib import Path
import json
root=Path('extrudecad-web/src')
p=root/'App.tsx';s=p.read_text(encoding='utf8').replace("event.key === ' ' && commandDraft.trim()","event.key === ' '");p.write_text(s,encoding='utf8')
p=root/'components/BottomControlDock.tsx';s=p.read_text(encoding='utf8').replace('测量 M · 两点 XY 距离与角度','测量 DI↵ · 两点 XY 距离与角度');p.write_text(s,encoding='utf8')
p=root/'components/Cad2DCanvas.tsx';s=p.read_text(encoding='utf8').replace('}>F7</button>',"}>{t('网格 F7')}</button>");p.write_text(s,encoding='utf8')
p=root/'locales/en.json';d=json.loads(p.read_text(encoding='utf8'));d.update({'连接':'Connected to','构件可见':'objects visible','网格 F9':'Snap F9','网格 F7':'Grid F7','测量 DI↵ · 两点 XY 距离与角度':'Measure DI ↵ · XY distance and angle'});p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
