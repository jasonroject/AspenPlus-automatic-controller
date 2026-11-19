// 供 Python 对拍测试和命令行使用：node aspen-advice-cli.mjs <probe-summary.json> [graph.json|-] [roles.json|-]
import {readFileSync} from 'node:fs';
import {advise, loadRules} from '../analysis_web/aspen-advice.mjs';
const [, , sum, graph, roles] = process.argv;
if (!sum) { console.error('用法：node aspen-advice-cli.mjs <probe-summary.json> [graph.json|-] [roles.json|-]'); process.exit(2); }
const rd = f => (f && f !== '-' ? JSON.parse(readFileSync(f, 'utf8')) : null);
console.log(JSON.stringify(advise(rd(sum), rd(graph), rd(roles), await loadRules())));
