#!/usr/bin/env node
/*
 * lint-i18n — fail the build when an i18n key referenced from code/templates
 * isn't present in src/assets/i18n/en.json (and warn when es.json is behind).
 *
 * Bug class this prevents:
 *   • A new component renders {{ 'foo.bar' | translate }} but the developer
 *     forgot to add `foo.bar` to en.json — silent in tsc, ng build, and unit
 *     tests; only surfaces in production as a raw key in the UI.
 *   • Renaming an i18n key but leaving an old usage that now resolves to the
 *     missing key.
 *
 * Patterns matched (statically extractable):
 *   • '<key>' | translate                              (template pipe, single quotes)
 *   • "<key>" | translate                              (template pipe, double quotes)
 *   • [translate]="'<key>'"                            (translate directive)
 *   • translate.instant('<key>')                       (programmatic, single quotes)
 *   • translate.instant("<key>")                       (programmatic, double quotes)
 *   • translate.get('<key>')                           (observable form)
 *   • i18nKey: '<key>' / labelKey: '<key>' / etc.      (config patterns flowing to UI)
 *
 * Patterns NOT matched (dynamic — would need an allowlist instead):
 *   • Template-literal keys: translate.instant(`foo.${x}`)
 *   • Variable keys: const k = 'foo.bar'; translate.instant(k)
 *   • Server-supplied keys (reference data labels)
 *
 * Allowlist: scripts/.lint-i18n-allow lists keys/prefixes that are known
 * to be supplied dynamically or by server data. One per line; lines ending
 * in `*` match by prefix.
 *
 * Exit code: 0 on pass, 1 on missing keys.
 *
 * Usage:
 *   node scripts/lint-i18n.mjs
 *
 * Wired into:
 *   • npm run lint:i18n
 *   • CI workflow (.github/workflows/ci.yml)
 *   • CLAUDE.md "validate locally before push" gate
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(REPO_ROOT, 'src');
const EN_PATH = join(REPO_ROOT, 'src/assets/i18n/en.json');
const ES_PATH = join(REPO_ROOT, 'src/assets/i18n/es.json');
const ALLOWLIST_PATH = join(import.meta.dirname, '.lint-i18n-allow');

// ─────────────────────────────────────────────────────────────────────
// Load i18n catalogs
// ─────────────────────────────────────────────────────────────────────

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

const enRaw = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
const enKeys = flatten(enRaw);
let esKeys = new Set();
if (existsSync(ES_PATH)) {
  esKeys = flatten(JSON.parse(readFileSync(ES_PATH, 'utf-8')));
}

// ─────────────────────────────────────────────────────────────────────
// Load allowlist (keys / prefixes the audit should ignore)
// ─────────────────────────────────────────────────────────────────────

const allowExact = new Set();
const allowPrefix = [];
if (existsSync(ALLOWLIST_PATH)) {
  for (const raw of readFileSync(ALLOWLIST_PATH, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('*')) allowPrefix.push(line.slice(0, -1));
    else allowExact.add(line);
  }
}
function isAllowed(key) {
  if (allowExact.has(key)) return true;
  for (const p of allowPrefix) if (key.startsWith(p)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Walk src/ collecting .ts and .html files (skip .spec.ts — specs use
// mocked TranslateLoader so they reference keys that may not exist for
// stub fixtures)
// ─────────────────────────────────────────────────────────────────────

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (
      (entry.endsWith('.ts') || entry.endsWith('.html')) &&
      !entry.endsWith('.spec.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

const sourceFiles = walk(SRC_DIR);

// ─────────────────────────────────────────────────────────────────────
// Extract i18n key references
// ─────────────────────────────────────────────────────────────────────

// Order matters: more specific patterns first to avoid double-counting
const PATTERNS = [
  // 'foo.bar' | translate    (single quotes, optional whitespace + chained pipes/params)
  { name: 'pipe-single', re: /'([a-zA-Z][\w]*(?:\.[\w]+)+)'\s*\|\s*translate(?::|[\s|}])/g },
  // "foo.bar" | translate    (double quotes)
  { name: 'pipe-double', re: /"([a-zA-Z][\w]*(?:\.[\w]+)+)"\s*\|\s*translate(?::|[\s|}])/g },
  // [translate]="'foo.bar'"  (Angular translate directive)
  { name: 'directive', re: /\[translate\]\s*=\s*"'([a-zA-Z][\w]*(?:\.[\w]+)+)'"/g },
  // translate.instant('foo.bar') / translate.get('foo.bar')
  { name: 'programmatic-single', re: /translate\.(?:instant|get|stream)\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g },
  { name: 'programmatic-double', re: /translate\.(?:instant|get|stream)\(\s*"([a-zA-Z][\w]*(?:\.[\w]+)+)"/g },
  // i18nKey: 'foo.bar' / labelKey: 'foo.bar' / tooltipKey / placeholderKey / messageKey
  // These are config properties that flow into translate calls elsewhere.
  { name: 'config-single', re: /\b(?:i18nKey|labelKey|tooltipKey|placeholderKey|messageKey|titleKey|descKey|hintKey|emptyMessageKey|emptyHelpKey|addLabelKey|missingMessageKey|displayNameKey|sourceLabelKey)\s*:\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g },
  { name: 'config-double', re: /\b(?:i18nKey|labelKey|tooltipKey|placeholderKey|messageKey|titleKey|descKey|hintKey|emptyMessageKey|emptyHelpKey|addLabelKey|missingMessageKey|displayNameKey|sourceLabelKey)\s*:\s*"([a-zA-Z][\w]*(?:\.[\w]+)+)"/g },
];

const usages = new Map(); // key -> [{ file, pattern }]
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf-8');
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const key = m[1];
      if (!usages.has(key)) usages.set(key, []);
      usages.get(key).push({ file: relative(REPO_ROOT, file), pattern: name });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Compare and report
// ─────────────────────────────────────────────────────────────────────

const missingFromEn = [];
const missingFromEs = [];

for (const [key, refs] of usages.entries()) {
  if (isAllowed(key)) continue;
  if (!enKeys.has(key)) missingFromEn.push({ key, refs });
  else if (!esKeys.has(key)) missingFromEs.push({ key, refs });
}

missingFromEn.sort((a, b) => a.key.localeCompare(b.key));
missingFromEs.sort((a, b) => a.key.localeCompare(b.key));

console.log(`lint-i18n: scanned ${sourceFiles.length} files, found ${usages.size} unique key references`);
console.log(`           en.json has ${enKeys.size} keys, es.json has ${esKeys.size} keys`);

if (missingFromEn.length > 0) {
  console.log(`\nERROR: ${missingFromEn.length} key(s) referenced in code but MISSING from en.json:`);
  for (const { key, refs } of missingFromEn) {
    console.log(`  ${key}`);
    for (const { file, pattern } of refs.slice(0, 3)) {
      console.log(`    ↳ ${file} (${pattern})`);
    }
    if (refs.length > 3) console.log(`    ↳ … and ${refs.length - 3} more reference(s)`);
  }
}

if (missingFromEs.length > 0) {
  console.log(`\nWARN: ${missingFromEs.length} key(s) in en.json but missing from es.json (won't fail the build):`);
  for (const { key } of missingFromEs.slice(0, 30)) {
    console.log(`  ${key}`);
  }
  if (missingFromEs.length > 30) console.log(`  … and ${missingFromEs.length - 30} more`);
}

if (missingFromEn.length > 0) {
  console.log(`\nFAILED: add missing keys to src/assets/i18n/en.json (and es.json), or add to scripts/.lint-i18n-allow if dynamically supplied.`);
  process.exit(1);
}

console.log(`\nOK: every i18n key referenced in code is present in en.json.`);
process.exit(0);
