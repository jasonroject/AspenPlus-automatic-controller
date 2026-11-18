from pathlib import Path
root=Path(__file__).resolve().parents[2]
p=root/'analysis_web/universal.js';s=p.read_text(encoding='utf-8')
needle="${r.possible_rank.join('–')}</td></tr>`).join('')}</tbody></table></div>`;"
assert needle in s
s=s.replace(needle,needle[:-1]+"+preferenceControlsHTML();")
s=s.replace("ranking=null;$('#rank-results').innerHTML='<p>Weights", "ranking=null;preferenceScan=null;$('#rank-results').innerHTML='<p>Weights")
s=s.replace("{project,report,ranking,created_at:","{project,report,ranking,preference_scan:preferenceScan,created_at:")
s=s.replace("weights:['energy','impact','yield'].map(k=>$('#weight-'+k).value),ranking,", "weights:['energy','impact','yield'].map(k=>$('#weight-'+k).value),ranking,preferenceScan:Boolean(preferenceScan),")
s=s.replace("if(state.ranking&&project.meta.comparable_cases)$('#rank').click();", "if(state.ranking&&project.meta.comparable_cases){$('#rank').click();if(state.preferenceScan){preferenceScan=scanPreferences(report,$('#rank-category').value,true);renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);}}")
s=s.replace("window.addEventListener('languagechange',()=>{if(report){render();}else updateWorkflow();translatePage();});", "window.addEventListener('languagechange',()=>{if(report){render();if(preferenceScan)renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);}else updateWorkflow();translatePage();});")
s += "\n$('#rank-results').addEventListener('click',guarded(event=>{if(!event.target.closest('[data-preference-run]'))return;preferenceScan=scanPreferences(report,$('#rank-category').value,project.meta.comparable_cases);renderPreferenceScan($('#rank-results [data-preference-output]'),preferenceScan);schedulePersist();}));\n"
p.write_text(s,encoding='utf-8')
p=root/'analysis_web/universal.html';s=p.read_text(encoding='utf-8').replace('<link rel="stylesheet" href="result-visuals.css">','<link rel="stylesheet" href="result-visuals.css"><link rel="stylesheet" href="uncertainty-views.css">');p.write_text(s,encoding='utf-8')
