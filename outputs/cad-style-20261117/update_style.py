from pathlib import Path
root=Path(__file__).resolve().parents[2]/'extrudecad-web'
palette={'#272a2f':'#111316','#1b1d21':'#08090b','#30343b':'#191c21','#1e2126':'#0b0d10','#3b4048':'#2b3038','#191b1f':'#0c0e11','#353b44':'#20252c','#343a43':'#20252c','#30363e':'#1b2027','#373c44':'#252a31','#263f5c':'#172a40','#40678d':'#355b83'}
for name in ['src/precision.css','src/index.css']:
 p=root/name;s=p.read_text(encoding='utf-8')
 for a,b in palette.items():s=s.replace(a,b)
 p.write_text(s,encoding='utf-8')
p=root/'src/components/Cad2DCanvas.tsx';s=p.read_text(encoding='utf-8').replace('#1b1d21','#08090b').replace("isMajor ? '#30353d' : '#23282f'","isMajor ? '#20242a' : '#14171b'")
s=s.replace('ctx.lineWidth = isSelected || isMarqueeHit ? 1.6 : 1.15;','ctx.lineWidth = isSelected || isMarqueeHit ? display.lineWidth + 0.5 : display.lineWidth;')
start=s.index('    // 5b. Boolean operation preview')
snap=s.index('    if (geometrySnap)',start) if '    if (geometrySnap)' in s[start:] else s.index('const gs =',start)
end=s.index('    // 6. Snap cursor crosshair',snap)
s=s[:snap]+s[snap:end].replace('#4c9aff','#59d98e').replace('rgba(76, 154, 255,','rgba(89, 217, 142,')+s[end:]
p.write_text(s,encoding='utf-8')
p=root/'src/components/Cad3DViewport.tsx';s=p.read_text(encoding='utf-8').replace('#1b1d21','#08090b').replace('0x1b1d21','0x08090b').replace('0x383e47','0x20242a').replace('0x282d35','0x14171b').replace('0x3b424d','0x252b33')
s=s.replace('context.beginPath(); context.arc(32, 32, 16, 0, Math.PI * 2); context.stroke();','// A small cross denotes a point; selected points remain distinct by size and color.')
s=s.replace('size: isSelected ? 22 : 18','size: isSelected ? 9 : 7')
s=s.replace('transparent: true, alphaTest: .1, depthTest: false, depthWrite: false, toneMapped: false, fog: false,','transparent: true, opacity: !isSelected && shapesRef.current.some((s) => s.visible && s.endpointIds?.includes(shape.id)) ? 0 : 1, alphaTest: .1, depthTest: false, depthWrite: false, toneMapped: false, fog: false,',1)
p.write_text(s,encoding='utf-8')
p=root/'src/utils/cadEngine.ts';s=p.read_text(encoding='utf-8').replace("zHeight: 0, zOffset: 0, bevel: 0, color: '#4C9AFF'","zHeight: 0, zOffset: 0, bevel: 0, color: '#D6DCE5'");p.write_text(s,encoding='utf-8')
