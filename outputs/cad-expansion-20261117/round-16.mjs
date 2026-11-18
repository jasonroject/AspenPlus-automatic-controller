const task=await taskSpace(10);const page=task.page('p2');
console.log(await page.evaluate(()=>({tail:document.body.innerText.slice(-1000),images:[...document.querySelectorAll('img')].map(x=>({alt:x.alt,src:x.src.slice(0,90)})).filter(x=>!x.src.includes('googleusercontent.com/a/'))})));
await page.fill('loc=role:textbox[name="为 Gemini 输入提示"]','第三轮，附上目前真实界面截图（1130×650）供你审阅。已实现并实际验证：100×50×10底板，Ø10×20圆柱在X=-30/Z=10，精确复制平移60mm生成另一圆柱；两圆心距测得60.00mm，缩放视图读数不变且不写历史；公共中心旋转90°、XYZ等比2倍、XYZ移至1000/1000/20及F适合视图均通过；新建/变换成功后面板自动收起。正在检验锁定、Esc取消拖动和命令面板。请结合截图给出最多4个本轮值得修的具体使用问题，避免推倒布局。另外当前只能导出DXF、不能导入；剩余时间是否应补“基础ASCII DXF闭合LWPOLYLINE/CIRCLE轮廓导入”，用于已有2D图纸继续拉伸？我们会明确不支持DWG/STEP、BLOCK/INSERT、斜OCS、弧段bulge，遇到未支持实体给出统计和不支持原因，不静默伪造形状。请建议安全的最小可用导入范围与验收(约500字)。');
await page.press('loc=role:textbox[name="为 Gemini 输入提示"]','Enter');
console.log({submitted:'Gemini round 3 with screenshots'});
