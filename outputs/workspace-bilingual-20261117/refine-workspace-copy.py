from pathlib import Path
path = Path(__file__).resolve().parents[2] / 'analysis_web' / 'universal.html'
text = path.read_text(encoding='utf-8')
replacements = {
    'Your analysis, connected.': 'Process analysis',
    'Start with your data. Follow a clear path to energy and impact.': 'Import process data. Check balances, environmental impacts and case comparisons in your browser.',
    'Import your data': 'Import &amp; map',
    'Choose, map and review tables': 'Load files and review five tables',
    'Check your basis': 'Review basis',
    'Explore the results': 'Results &amp; comparison',
    'Bring your export.': 'Import data files',
    'Choose CSV, Excel or a saved JSON project. English and Chinese headers are supported.': 'Select CSV, Excel or a saved JSON project. Files are processed locally; English and Chinese headers are supported.',
    'Try it with an example.': 'Start with a sample',
    'Try the worked example': 'Load worked example',
    'Load the verified HTL example ↗': 'Load native HTL example ↗',
    'One native run, with inherited factors and an explicit accounting boundary.': 'An Aspen export with source records, a declared inventory and retained simulator warnings.',
    'Review the suggested mapping.': 'Review column mapping',
    'Pick the destination table, check each field, then apply this worksheet.': 'Choose the matching table, review column names and units, then apply this worksheet.',
    'Apply reviewed mapping →': 'Apply this worksheet →',
    'Five tables. One connected model.': 'Project tables',
    'Select a table to inspect or edit its records.': 'Select a table to review its records. Missing values remain unknown.',
    'A quick project check.': 'Review required inputs',
    'Calculation basis.': 'Calculation basis',
    'Tell the calculation what your system includes and what each result represents.': 'Define the system boundary, 1 kg target product and allocation rule.',
    'Inventory &amp; factor coverage.': 'Inventory &amp; factors',
    'Supply a factor, method, unit and source for every intended category.': 'Provide a sourced factor for each inventory item and impact category.',
    'Your results, at a glance.': 'Calculation summary',
    'Read the summary first, then explore the supporting calculations.': 'Check the status, then inspect charts and source records.',
    'Follow the energy.': 'Energy balances',
    'Put the impact in context.': 'Impact results',
    'Nominal values and fuzzy supports, with source lineage one click away.': 'Read nominal values and support bounds. Open source records for each contribution.',
    'Explore the trade-offs.': 'Compare cases',
    'From this case to operating variation.': 'Explore operating variation'
}
for old,new in replacements.items():
    # Existing HTML uses both escaped and literal ampersands.
    target = old if old in text else old.replace('&amp;', '&')
    if target not in text:
        raise SystemExit('Missing copy target: '+old)
    text = text.replace(target,new)
path.write_text(text,encoding='utf-8')
