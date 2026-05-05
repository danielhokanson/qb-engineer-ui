#!/usr/bin/env node
/*
 * lint-i18n — fail the build when an i18n key referenced from code/templates
 * isn't present in public/assets/i18n/en.json (and warn when es.json is behind).
 *
 * IMPORTANT: i18n files are bundled from `public/assets/`, NOT `src/assets/`.
 * The Angular CLI default migrated to `public/` at some point and `src/assets/`
 * was kept around as a vestigial shadow. Editing the wrong file is silent in
 * tsc, ng build, vitest (which uses a mocked TranslateLoader), AND used to be
 * silent here — every key showed up at runtime as a raw `foo.bar` token. We
 * caught it in a screenshot review on 2026-05-04 and consolidated everything
 * to `public/assets/i18n/`. Don't reintroduce `src/assets/i18n/`.
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
const EN_PATH = join(REPO_ROOT, 'public/assets/i18n/en.json');
const ES_PATH = join(REPO_ROOT, 'public/assets/i18n/es.json');
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

// ─────────────────────────────────────────────────────────────────────
// Trap-fail: src/assets/i18n must not contain meaningful content.
// ─────────────────────────────────────────────────────────────────────
//
// Angular CLI's static-asset directory migrated from src/assets/ to public/.
// This project keeps public/assets/i18n/ as the bundled source of truth
// (per angular.json). Editing src/assets/i18n/ is a tar-pit:
//   • tsc, ng build, ng test all green
//   • lint:i18n was historically green (it used to read src/assets too)
//   • runtime: every key shows as a raw `foo.bar` token because the bundled
//     en.json (from public/) doesn't have the new keys
//
// We deleted src/assets/i18n/ on 2026-05-04 and added it to .gitignore so
// IDE auto-save buffers can't sneak it back into the repo. This guard fires
// when the directory exists AND contains content that isn't already in
// public/assets/i18n/ — accidental empty placeholders from an editor buffer
// don't trigger the trap, but a real divergent edit does.
const FORBIDDEN_SRC_I18N = join(REPO_ROOT, 'src/assets/i18n');
if (existsSync(FORBIDDEN_SRC_I18N)) {
  for (const fname of readdirSync(FORBIDDEN_SRC_I18N)) {
    if (!fname.endsWith('.json')) continue;
    const phantomPath = join(FORBIDDEN_SRC_I18N, fname);
    let phantomKeys;
    try {
      phantomKeys = flatten(JSON.parse(readFileSync(phantomPath, 'utf-8')));
    } catch {
      continue; // unparseable garbage — not a real translation file, ignore
    }
    if (phantomKeys.size === 0) continue; // empty placeholder, harmless
    const canonicalPath = join(REPO_ROOT, 'public/assets/i18n', fname);
    const canonicalKeys = existsSync(canonicalPath)
      ? flatten(JSON.parse(readFileSync(canonicalPath, 'utf-8')))
      : new Set();
    const orphans = [...phantomKeys].filter(k => !canonicalKeys.has(k));
    if (orphans.length > 0) {
      console.error(`\nFAILED: src/assets/i18n/${fname} contains ${orphans.length} key(s) NOT in public/assets/i18n/${fname}.\n`);
      console.error('  Angular bundles i18n from public/assets/i18n/ (per angular.json).');
      console.error('  src/assets/i18n/ is NOT bundled — keys here will render as raw "foo.bar" at runtime.');
      console.error('  Move your additions to public/assets/i18n/ and delete src/assets/i18n/.');
      console.error(`  First few orphans: ${orphans.slice(0, 5).join(', ')}\n`);
      process.exit(1);
    }
  }
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

function walk(dir, files = [], extensions) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist'
        || entry === 'bin' || entry === 'obj') continue;
    // Skip test directories on both sides — fixtures use synthetic keys
    // ("validators.parts.tempCustom") that are NOT real i18n strings.
    if (entry.endsWith('.tests') || entry === 'qb-engineer.tests') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files, extensions);
    else if (
      extensions.some(ext => entry.endsWith(ext)) &&
      !entry.endsWith('.spec.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

const sourceFiles = walk(SRC_DIR, [], ['.ts', '.html']);

// Cross-repo: also scan the sibling server repo's seed code for label /
// validator i18n keys. The server stamps these strings into the database
// (workflow definition stepsJson, EntityReadinessValidator rows) and the
// UI renders them via translate — but the bug class is identical to a
// missing key in the UI source: silent in tsc/build, raw key in prod UI.
//
// We scan a fixed list of sibling-repo paths so the check works in
// repos where the server isn't checked out (CI runs separately).
const SERVER_DIRS = [
  resolve(REPO_ROOT, '..', 'qb-engineer-server'),
];
const serverFiles = [];
for (const dir of SERVER_DIRS) {
  if (existsSync(dir)) walk(dir, serverFiles, ['.cs']);
}

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

// Server-side patterns for stamped labelKey / DisplayNameKey strings.
// We only fire on a known-prefix allowlist so an arbitrary string like
// "Customer.Type" doesn't get treated as an i18n key.
const SERVER_KEY_PREFIXES = ['workflow.', 'validators.', 'terminology.'];
const SERVER_PATTERNS = [
  // C# string-literal labelKey / DisplayNameKey / MissingMessageKey:
  //   labelKey: "workflow.parts.steps.basics"
  //   DisplayNameKey: "validators.parts.hasBasics"
  //   "labelKey":"workflow.parts.steps.basics"  (inline JSON in a verbatim string)
  { name: 'cs-key', re: /"((?:workflow|validators|terminology)\.[a-zA-Z][\w]*(?:\.[\w]+)+)"/g },
];
for (const file of serverFiles) {
  const content = readFileSync(file, 'utf-8');
  for (const { name, re } of SERVER_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const key = m[1];
      if (!SERVER_KEY_PREFIXES.some(p => key.startsWith(p))) continue;
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

console.log(`lint-i18n: scanned ${sourceFiles.length} ui files + ${serverFiles.length} server files, found ${usages.size} unique key references`);
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

// ─── 100% language-parity rule (2026-05-05) ──────────────────────────
// Per the project rule: every mapped language must be 100% in sync with
// en.json (the canonical source). Both directions:
//   • Keys in en.json that are missing from es.json → block (untranslated)
//   • Keys in es.json that are missing from en.json → block (orphans)
// Add a new mapped language by appending its set to PARITY_LANGS below
// and including its key set in the comparisons.
const enOnlyKeys = [...enKeys].filter(k => !esKeys.has(k)).sort();
const esOnlyKeys = [...esKeys].filter(k => !enKeys.has(k)).sort();

if (missingFromEs.length > 0 || enOnlyKeys.length > 0) {
  // missingFromEs is the subset of enOnlyKeys that's also referenced in
  // code; enOnlyKeys catches the rest (en-only keys not referenced in
  // code but still need to be translated for parity).
  const all = enOnlyKeys; // superset of missingFromEs
  console.log(`\nERROR: ${all.length} key(s) in en.json are MISSING from es.json:`);
  for (const key of all.slice(0, 50)) {
    console.log(`  ${key}`);
  }
  if (all.length > 50) console.log(`  … and ${all.length - 50} more`);
}

if (esOnlyKeys.length > 0) {
  console.log(`\nERROR: ${esOnlyKeys.length} orphan key(s) in es.json with no en.json counterpart:`);
  for (const key of esOnlyKeys.slice(0, 50)) {
    console.log(`  ${key}`);
  }
  if (esOnlyKeys.length > 50) console.log(`  … and ${esOnlyKeys.length - 50} more`);
}

const failed =
  missingFromEn.length > 0 ||
  enOnlyKeys.length > 0 ||
  esOnlyKeys.length > 0;

if (failed) {
  console.log(`\nFAILED: i18n parity broken. Mapped languages must be 100% in sync with en.json.`);
  console.log(`  • Missing en keys → add to src/assets/i18n/en.json`);
  console.log(`  • en→es gaps → translate the listed keys into es.json`);
  console.log(`  • es-only orphans → remove from es.json (or add the matching en.json entry)`);
  console.log(`  • Dynamic keys assembled at runtime → add to scripts/.lint-i18n-allow`);
  process.exit(1);
}

console.log(`\nOK: every i18n key in en.json is mirrored in es.json (no missing, no orphans).`);
process.exit(0);
