from pathlib import Path
root=Path(__file__).resolve().parents[2]/'analysis_web'
replacements={
    'docs-content.mjs': {
        'choose the guided generic example in step 1': 'select <strong>Load worked example</strong> in step 1',
        '<strong>Apply reviewed mapping</strong>':'<strong>Apply this worksheet</strong>',
        '<strong>Load verified HTL example</strong>':'<strong>Load native HTL example</strong>'
    },
    'docs-content.zh.mjs': {
        '“运行引导示例”':'“加载引导示例”',
        '“应用已检查的映射”':'“应用当前工作表”',
        '“加载已核查的 HTL 示例”':'“加载原生 HTL 示例”'
    }
}
for name,updates in replacements.items():
    path=root/name
    text=path.read_text(encoding='utf-8')
    for old,new in updates.items():
        if old not in text:raise SystemExit('Missing label: '+old)
        text=text.replace(old,new)
    path.write_text(text,encoding='utf-8')
