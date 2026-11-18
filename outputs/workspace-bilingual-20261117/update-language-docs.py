from pathlib import Path
root = Path(__file__).resolve().parents[2] / 'analysis_web'
path = root / 'docs-content.mjs'
text = path.read_text(encoding='utf-8')
updates = {
    'Use <strong>Save project</strong> before closing or reloading; export the result and audit separately after calculating.': 'Applied inputs and staged work are retained in this tab session. Use <strong>Save project</strong> for a permanent copy; export the result and audit separately after calculating. Clearing browser data removes session recovery.',
    'Imported files and their calculations stay in browser memory. Saving/exporting creates local downloads.': 'Imported files and calculations stay in this browser. Applied inputs and staged work are retained in tab-session storage for return navigation; saving/exporting creates permanent local downloads.',
    'Uploaded inputs are in browser memory. Re-import a project saved with <strong>Save project</strong>. The website does not create an automatic cloud backup.': 'This tab retains applied inputs and staged edits for return navigation. After clearing browser data or starting a different session, re-import a project saved with <strong>Save project</strong>. The website does not create an automatic cloud backup. EN / 中文 changes the interface across pages without changing inputs, draft edits, identifiers or units.',
    'The general calculation reproduces its declared foreground carbon accounting.': 'The general calculation reproduces its declared foreground carbon accounting. From the results, continue to the matching reference HTL condition and inspect predictions and operating-scenario stability. The interface keeps imported calculations and frozen reference predictions clearly labelled.',
    "['docs-content.mjs, docs.mjs','Documentation articles, navigation and search.']": "['docs-content.mjs, docs-content.zh.mjs, docs.mjs','English/Chinese documentation articles, navigation and bilingual search.'],['i18n.mjs, i18n-dictionary.mjs','Global interface language and UI translations; input data remains unchanged.'],['result-visuals.mjs','Charts derived from the current project and assessment results.']"
}
for old,new in updates.items():
    if old not in text:
        raise SystemExit('Missing documentation target: ' + old[:80])
    text = text.replace(old,new)
path.write_text(text,encoding='utf-8')
