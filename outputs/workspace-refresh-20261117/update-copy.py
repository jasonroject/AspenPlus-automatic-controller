from pathlib import Path
root=Path(__file__).resolve().parents[2]/'analysis_web'
p=root/'universal.js'
text=p.read_text(encoding='utf-8').replace('No factors: no LCIA total can be calculated.','Impact totals are unavailable. Review the reference-product inputs and factor coverage.')
p.write_text(text,encoding='utf-8')
p=root/'docs-content.mjs'
text=p.read_text(encoding='utf-8')
text=text.replace('and select <strong>Load generic example</strong>. The app moves to <strong>Basis & factors</strong>.','and choose the guided generic example in step 1. The app moves to step 2, <strong>Review the basis</strong>.')
text=text.replace('Select <strong>Calculate balances and impact intervals</strong>.','Use the calculate button in step 2 to open the results summary.')
text=text.replace('Choose <strong>Illustrative climate</strong> and select <strong>Evaluate ranking</strong>.','Open the comparison section, choose <strong>Illustrative climate</strong> and evaluate the ranking.')
text=text.replace('Use <strong>Save project</strong> to download inputs and <strong>Export result & audit</strong> to download computed outputs.','Use <strong>Save project</strong> to download inputs and the results export button to download computed outputs and their audit.')
text=text.replace('Duplicate IDs are rejected during validation.</li>','Duplicate IDs are rejected during validation. Use <strong>Next worksheet</strong> to continue; the progress counter tracks applied worksheets. Staged but unapplied sheets do not enter the calculation.</li>')
text=text.replace('for a complete structured view.</p>','for a complete structured view. Apply or discard JSON edits before continuing; unapplied drafts disable conflicting actions. Changing applied inputs invalidates old results until you calculate again.</p>')
p.write_text(text,encoding='utf-8')
