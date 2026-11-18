# Inter font asset

Local, unmodified upright variable font for the English HTL interface. No system font installation or third-party font request is required at page load.

- Family: Inter Variable; official release 4.1.
- Font file: `InterVariable.woff2`, 352,240 bytes.
- Downloaded: 2026-11-17 from https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1 .
- Official release copy: https://github.com/rsms/inter/blob/v4.1/docs/font-files/InterVariable.woff2 .
- Source stylesheet: https://rsms.me/inter/inter.css .
- License: SIL Open Font License 1.1; original license included as `LICENSE-Inter.txt`, retrieved from https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt .
- SHA-256: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.

The WOFF2 header and exact equality with the official v4.1 WOFF2 were checked. Metadata and character coverage were inspected using the corresponding official v4.1 TTF in memory (not retained): internal version `4.001;git-9221beed3`, 2,937 glyphs and 2,852 mapped Unicode code points, weight axis 100–900 and optical-size axis 14–32. The inspected source contains the interface's degree, micro, Greek, arithmetic, subscript, superscript, arrow and check-mark symbols, including `° µ μ Δ Ω ± × ÷ − · ₂ ₃ ¹ ² ³ ⁻ → ↗ ✓ ≤ ≥`.

Suggested declaration from a stylesheet in `analysis_web/`:

```css
@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("vendor/fonts/InterVariable.woff2") format("woff2");
}
```

Use `font-optical-sizing: auto` and `font-variant-numeric: tabular-nums` for interface and numerical alignment. Body 400–500, controls 600 and headings/values 650–700 can use the same file.
