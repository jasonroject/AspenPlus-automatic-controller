# Reviewed bilingual workspace copy

Reference: `argon-copy-review.json`, obtained by the parent agent from Gemini 4 Argon in Google AI Studio. It is a copy proposal, not scientific evidence or implementation verification.

## Accepted, with concise wording

| Purpose | Implemented English | Implemented Chinese |
|---|---|---|
| Workspace title | Process analysis | 过程分析 |
| Step 1 | Import & map | 导入与映射 |
| Step 2 | Review basis | 检查核算依据 |
| Step 3 | Results & comparison | 结果与比较 |
| Own data | Import data files | 导入数据文件 |
| Synthetic fixture | Load worked example | 加载引导示例 |
| Native fixture | Load native HTL example | 加载原生 HTL 示例 |
| Mapping | Review column mapping / Apply this worksheet | 检查字段映射 / 应用当前工作表 |
| Input overview | Project tables / Review required inputs | 项目数据表 / 检查必需输入 |
| Results | Calculation summary / Impact results / Compare cases | 计算摘要 / 环境影响结果 / 比较工况 |
| Continue | Explore operating variation | 分析操作条件变化 |

Action labels use verbs. Headings stay short; methods and limits are explained below the relevant component. The liked public-home title, layout and animation are preserved. Canonical field names, imported source text, data identifiers and exported values remain unchanged.

## Rejected or corrected

- **Net purchased energy:** rejected. Current inventory calculation does not credit exported energy. Retain Purchased energy and its explicit kWh/kg target-product unit.
- **Product-to-feed ratio per 1 kg product:** rejected. This metric is target-product mass divided by feed mass, displayed as a percentage; it is not normalized again to 1 kg product.
- **Load precomputed GP grid:** rejected as a button name. The action selects a prediction at the current grid point; it does not create or train a grid. Recommend Show prediction / 查看预测, with the frozen-grid explanation nearby.
- **Only matched factors are included:** rejected as a standalone completeness description. Missing factors produce a labelled partial subtotal and prevent ranking for that category; they are not silently ignored or set to zero.
- **Accounting balance / 账面衡算:** retained the conventional Balance check / 衡算检查 wording and the existing numerical-versus-physical distinction. No unsupported physical-validation claim was introduced.
- **Five tables overview as a full sentence heading:** reduced to Project tables. Missing-value handling remains a separate sentence.
- **Long prediction/ranking headings containing all 266/1,024 counts and caveats:** keep counts and assumptions in explanatory text. This preserves scanability and avoids crowded headings.
- **Scenario extrapolation:** do not use this term for the bounded HTL grid. No extrapolation beyond the supported domain is performed.

## Language behavior checked in source/tests

- One preference for the entire site, persisted independently of analysis inputs.
- Static labels, dynamic result messages and chart labels use the same EN/中文 control.
- A language change never assigns to input values or changes exported scientific data.
- Option values are frozen before visible labels are translated.
- Existing Chinese and English archive pages preserve the complete operating-condition hash when switching.
- All 13 document articles share article IDs, deep-link section IDs and exact executable code examples.
- Chinese source annotations explicitly identify untranslated source prose as original text.

Ego browser verification is performed by the parent agent; this note does not substitute for those interaction checks.
