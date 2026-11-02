/**
 * Mechanical accessibility / responsiveness audit (Golden Master §60).
 *
 * This is a static audit, not a browser test: it proves what can be proven from the source
 * and reports everything that needs a human or a headless browser. Run with:
 *
 *   bun run scripts/a11y-audit.ts
 *
 * Exit code 1 only when a hard requirement fails (document language/direction, viewport,
 * visible focus, reduced-motion support, dialog semantics, palette contrast). Soft findings
 * — missing labels on individual controls, missing alt text — are printed and counted so
 * the report can quote real numbers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONTRAST_PAIRS, PALETTE } from '../src/lib/designTokens';
import { contrastRatio } from '../src/lib/contrast';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts|css)$/.test(entry)) out.push(full);
  }
  return out;
};

const files = walk(SRC);
const read = (path: string): string => readFileSync(path, 'utf8');
const rel = (path: string): string => relative(ROOT, path);

interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

const findings: Finding[] = [];
const hardFailures: string[] = [];

const addFinding = (file: string, line: number, rule: string, detail: string): void => {
  findings.push({ file: rel(file), line, rule, detail });
};

const tsxFiles = files.filter((path) => path.endsWith('.tsx'));
const cssFiles = files.filter((path) => path.endsWith('.css'));
const css = cssFiles.map(read).join('\n');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ---- hard requirements -----------------------------------------------------
const htmlChecks: Array<{ rule: string; ok: boolean; detail: string }> = [
  { rule: 'document-language', ok: /<html[^>]+lang="(ar|en)"/.test(html), detail: 'index.html declares lang' },
  { rule: 'document-direction', ok: /<html[^>]+dir="(rtl|ltr)"/.test(html), detail: 'index.html declares dir' },
  { rule: 'viewport-meta', ok: /name="viewport"[^>]+width=device-width/.test(html), detail: 'viewport meta present' },
  { rule: 'visible-focus', ok: /:focus-visible/.test(css), detail: 'a :focus-visible rule exists' },
  { rule: 'reduced-motion', ok: /prefers-reduced-motion/.test(css), detail: 'prefers-reduced-motion honoured' },
  { rule: 'responsive-breakpoints', ok: (css.match(/@media[^{]*max-width/g) ?? []).length >= 3, detail: 'at least three max-width breakpoints' },
  { rule: 'dialog-semantics', ok: /role="dialog"/.test(tsxFiles.map(read).join('\n')) && /aria-modal/.test(tsxFiles.map(read).join('\n')), detail: 'a dialog exposes role="dialog" and aria-modal' },
];

for (const check of htmlChecks) {
  if (!check.ok) hardFailures.push(`${check.rule}: ${check.detail}`);
}

// ---- palette contrast (hard) ----------------------------------------------
const contrastRows = CONTRAST_PAIRS.map((pair) => {
  const ratio = contrastRatio(PALETTE[pair.fg], PALETTE[pair.bg]);
  return { ...pair, ratio, pass: ratio >= pair.min };
});
for (const row of contrastRows.filter((entry) => !entry.pass)) {
  hardFailures.push(`contrast: ${row.fg} on ${row.bg} is ${row.ratio}:1, target ${row.min}:1`);
}

// ---- soft findings ---------------------------------------------------------
for (const file of tsxFiles) {
  const lines = read(file).split('\n');
  /** A control inside a <label> block is labelled implicitly; look back 12 lines. */
  const insideLabel = (index: number): boolean =>
    lines.slice(Math.max(0, index - 12), index + 1).some((candidate) => /<label\b/.test(candidate));

  lines.forEach((line, index) => {
    const number = index + 1;
    const labelled = insideLabel(index);

    if (/<img\b/.test(line) && !/alt=/.test(line)) {
      addFinding(file, number, 'img-alt', 'image without alt text');
    }
    const nearby = lines.slice(Math.max(0, index - 4), index + 5).join(' ');
    if (/<button\b/.test(line) && !/type=/.test(nearby)) {
      addFinding(file, number, 'button-type', 'button without an explicit type in its opening tag');
    }
    if (!labelled && /<input\b/.test(line) && !/(aria-label|aria-labelledby|id=)/.test(line)) {
      addFinding(file, number, 'input-label', 'input is neither wrapped in a label nor given an id/aria-label');
    }
    if (!labelled && /<select\b/.test(line) && !/(aria-label|aria-labelledby|id=)/.test(line)) {
      addFinding(file, number, 'select-label', 'select is neither wrapped in a label nor given an id/aria-label');
    }
    if (!labelled && /<textarea\b/.test(line) && !/(aria-label|aria-labelledby|id=)/.test(line)) {
      addFinding(file, number, 'textarea-label', 'textarea is neither wrapped in a label nor given an id/aria-label');
    }
  });
}

// Inputs are usually labelled by an enclosing <label>; count those separately so the
// report does not overstate the problem.
const labelWrapped = tsxFiles.reduce((total, file) => {
  const source = read(file);
  return total + (source.match(/<label[\s\S]{0,400}?<(input|select|textarea)\b/g) ?? []).length;
}, 0);

// ---- responsiveness inventory ---------------------------------------------
const breakpoints = [...new Set((css.match(/@media[^{]*max-width:\s*([0-9]+)px/g) ?? []).map((rule) => rule.match(/([0-9]+)px/)?.[1]))].filter(Boolean);

// ---- summary ---------------------------------------------------------------
const byRule = findings.reduce<Record<string, number>>((acc, finding) => {
  acc[finding.rule] = (acc[finding.rule] ?? 0) + 1;
  return acc;
}, {});

console.log('ICONCRETE accessibility / responsive audit (static)');
console.log(`scanned: ${tsxFiles.length} tsx, ${cssFiles.length} css, 1 html`);
console.log(`breakpoints: ${breakpoints.map((value) => `${value}px`).join(', ') || 'none'}`);
console.log(`label-wrapped controls: ${labelWrapped}`);
console.log(`contrast pairs: ${contrastRows.filter((row) => row.pass).length}/${contrastRows.length} pass`);
console.log(`soft findings: ${findings.length}`);
for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule}: ${count}`);
}
const sample = findings.slice(0, 40);
for (const finding of sample) {
  console.log(`  - ${finding.file}:${finding.line} [${finding.rule}] ${finding.detail}`);
}
if (findings.length > sample.length) {
  console.log(`  … ${findings.length - sample.length} more (see docs/ACCESSIBILITY_AUDIT.md)`);
}

if (hardFailures.length > 0) {
  console.error('\nHARD FAILURES');
  for (const failure of hardFailures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nmechanical checks: PASS');
console.log('not verified here: real screen-reader output, browser zoom/reflow, keyboard tab order');
console.log('in a live browser, touch-target sizes at 320/768/1280px — see docs/ACCESSIBILITY_AUDIT.md');
