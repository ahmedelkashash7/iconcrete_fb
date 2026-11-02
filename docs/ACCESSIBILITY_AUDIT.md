# Accessibility and responsive audit (B3)

Mechanical results produced by `bun run scripts/a11y-audit.ts` plus the contrast test
`tests/design.tokens.test.ts`. The distinction between *verified mechanically* and *not
verified* is the point of this file (§60, §57.13).

## Verified mechanically (this environment)

| Check | Method | Result |
|---|---|---|
| Document language and direction | static: `index.html` | `lang="ar" dir="rtl"` present |
| Viewport / reflow opt-in | static | `width=device-width, initial-scale=1.0` |
| Visible focus | static: `:focus-visible` rules in `src/index.css` | present for global, buttons, nav, fields, dialog |
| Reduced motion | static: `prefers-reduced-motion` block | present (animations/transitions clamped) |
| Breakpoints | static: `@media (max-width: …)` | 4 (`1180`, `1024`, `860`, `640`px) |
| Contrast contract | `tests/design.tokens.test.ts` | 17/17 pairs pass their WCAG target |
| Labelled controls | static lookback for `<label>` wrappers / `id` / `aria-label` | 0 unlabelled controls, 57 label-wrapped |
| Images | static `<img>` scan | no `<img>` elements; icons are inline SVG with `aria-hidden` |
| Button type | static scan ±4 lines | 0 buttons missing `type` |
| Dialog semantics | static | `role="dialog"` + `aria-modal="true"` + `aria-labelledby` |
| Table overflow | CSS | `.table-wrap { overflow-x: auto }` + `min-width: 560px` |
| Form error announcement | static | `aria-invalid` + `aria-describedby` + `role="alert"` on the error hint |
| Loading / empty / error states | design-system page + components | `LoadingBlock` (`role="status"`), empty state, `ErrorNote` (`role="alert"`) |
| Arabic RTL and English LTR | design-system page renders both directions of the same controls | verified in code, not in a browser |

## Measured contrast (WCAG 2.1)

| Pair | Ratio | Target | Verdict |
|---|---|---|---|
| Body text on surface | 17.85:1 | 4.5 | AAA |
| Body text on background | 17.06:1 | 4.5 | AAA |
| Muted text on surface | 4.76:1 | 4.5 | AA |
| Muted text on background | 4.55:1 | 4.5 | AA |
| Primary purple on surface | 7.10:1 | 4.5 | AAA |
| Dark purple on surface | 10.95:1 | 4.5 | AAA |
| Accent blue on surface | 5.17:1 | 4.5 | AA |
| Danger red on surface | 4.83:1 | 4.5 | AA |
| White on primary button | 7.10:1 | 4.5 | AAA |
| White on accent button | 5.17:1 | 4.5 | AA |
| White on danger | 4.83:1 | 4.5 | AA |
| Secondary purple on surface | 4.23:1 | 3.0 (large only) | AA-large |
| Success green on surface | 3.30:1 | 3.0 (large only) | AA-large |
| Warning amber on surface | 2.15:1 | 1.5 (non-text marker) | pass as marker |

Consequence, enforced in `src/lib/designTokens.ts`: success/warning/secondary are **never**
used as normal-size body text on white. Badges use tinted backgrounds (`#DCFCE7`/`#FEF3C7`
with dark text), which is what `src/index.css` already does.

## NOT verified (requires a browser or a person)

| Item | Why | How to close |
|---|---|---|
| Screen-reader output (NVDA/JAWS/VoiceOver) | no assistive technology in the runner | manual pass on a workstation |
| Keyboard tab order end-to-end | static focus styles exist; no browser | Playwright walkthrough |
| 320/768/1280 px rendering | no browser | screenshots at three widths |
| Touch-target sizes | needs layout metrics | DevTools audit |
| Browser zoom 200 % / text reflow | needs layout | manual |
| Colour rendering on real displays | contrast is computed from tokens, not measured on a panel | spot check |
| CSV wizard and dialog focus trap | trap implemented by `Escape`/`aria-modal`, not by a tested trap | Playwright keyboard test |

These stay open in `docs/ISSUES_AND_GAPS.md` (G6) and are marked NOT TESTED in
`docs/B3_REPORT.md`; nothing above is reported as a browser pass.
