from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

plt.rcParams["pdf.fonttype"] = 42
font = FontProperties(fname="C:/Windows/Fonts/msyh.ttc")
bold = FontProperties(fname="C:/Windows/Fonts/msyhbd.ttc")
fig = plt.figure(figsize=(15.8, 5.4), facecolor="white")
ax = fig.add_axes((0, 0, 1, 1))
ax.set(xlim=(0, 15.8), ylim=(0, 5.4))
ax.axis("off")

ink, muted, line = "#192D3A", "#4D6472", "#617A88"
blue, teal, ochre = "#315E81", "#176C65", "#97611E"

def label(x, y, content, size=11, color=ink, weight=False, align="center"):
    ax.text(x, y, content, fontsize=size, color=color, fontproperties=bold if weight else font,
            ha=align, va="center", linespacing=1.45, zorder=5)

def box(x, y, w, h, title, body, color=blue, fill="#F4F8FB"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.11",
                               ec=color, fc=fill, lw=1.0, zorder=2))
    label(x+w/2, y+h*.70, title, 12.2, color, True)
    label(x+w/2, y+h*.34, body, 10.4)

def arrow(points, color=line):
    xs, ys = zip(*points[:-1])
    if len(xs)>1:
        ax.plot(xs, ys, lw=1.15, color=color, solid_capstyle="round", zorder=3)
    ax.add_patch(FancyArrowPatch(points[-2], points[-1], arrowstyle="-|>",
                                 mutation_scale=12, color=color, lw=1.15,
                                 shrinkA=0, shrinkB=0, zorder=3))

label(.45, 4.98, "能量集成、生命周期碳足迹与工况筛选", 20, ink, True, "left")
label(.47, 4.54, "配对比较基准   1 h / 100 kg 湿进料", 11, muted, False, "left")
ax.plot([.45,15.35],[4.29,4.29],color="#DCE5EB",lw=.9)
for x,title in [(1.74,"能量集成方案"),(6.03,"生命周期评价"),(10.08,"碳足迹计算"),(14.10,"后续分析")]:
    label(x, 3.98, title, 13.5, ink, True)

box(.45,2.67,2.58,.98,"STD  标准加热","外部电加热",blue,"#EEF5FA")
box(.45,1.35,2.58,.98,"HR  热回收","出料预热进料＋补充电加热",teal,"#ECF6F3")
box(4.61,1.72,2.84,1.55,"前景清单与影响评价","openLCA · ecoinvent\nReCiPe 2016 · 蒙特卡洛抽样")
box(8.85,1.72,2.46,1.55,"单位目标单体碳足迹","CF = GWP / 目标单体净质量\nkg CO$\\mathregular{_2}$-eq/kg 所含目标单体",teal,"#ECF6F3")
box(12.84,2.50,2.51,.98,"多准则工况筛选","Pareto 筛选与偏好加权",blue,"#EEF5FA")
box(12.84,1.35,2.51,.98,"HR 情景敏感性","评估热回收对工况排序的影响",teal,"#ECF6F3")

ax.plot([3.03,3.53,3.53],[3.16,3.16,2.49],lw=1.15,color=blue,zorder=3)
ax.plot([3.03,3.53,3.53],[1.84,1.84,2.49],lw=1.15,color=teal,zorder=3)
arrow([(3.53,2.49),(4.61,2.49)])
label(4.07,2.94,"物料与\n能耗清单",9.6,muted)
arrow([(7.45,2.49),(8.85,2.49)])
label(8.15,2.82,"GWP",10.5,muted)
arrow([(11.31,2.55),(11.85,2.55),(11.85,2.99),(12.84,2.99)],blue)
arrow([(11.31,2.42),(11.85,2.42),(11.85,1.84),(12.84,1.84)],teal)
label(12.36,3.24,"STD CF",9.8,blue)
label(12.36,2.10,"HR CF",9.8,teal)

box(8.85,.37,2.46,.68,"出口目标单体净质量","同一工况下 STD / HR 共用",ochre,"#FBF6EB")
arrow([(10.08,1.05),(10.08,1.72)],ochre)
label(14.10,3.73,"目标单体产率 · 焦炭代理指标",9.7,ochre)
arrow([(14.10,3.62),(14.10,3.48)],ochre)
label(6.03,1.34,"从摇篮到工厂大门",10,muted)
output = Path(__file__).resolve().parent / "htl_energy_lca_workflow"
fig.savefig(output.with_suffix(".png"), dpi=190)
fig.savefig(output.with_suffix(".pdf"))



