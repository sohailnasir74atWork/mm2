#!/usr/bin/env node
/**
 * fetch-live-functions.js — download the source that is ACTUALLY DEPLOYED.
 *
 * Why this exists: on 2026-09-06 two functions had been live in this project
 * for over a year — `notifyNewMessage` (337k invocations/month) and
 * `cleanUpNoContentMessages` (116k/month) — with no source anywhere in the
 * repo. Nobody could review them, and both turned out to have real defects.
 * The repo is not the source of truth for what is running; this is.
 *
 * What it does:
 *   1. lists every live function (1st and 2nd gen)
 *   2. pulls each one's deployed archive from its GCS source bucket
 *   3. extracts it, skipping node_modules
 *   4. compares each against the repo and says which are missing or drifted
 *
 * Usage:
 *   node scripts/fetch-live-functions.js
 *   node scripts/fetch-live-functions.js --project fruiteblocks
 *   node scripts/fetch-live-functions.js --out /tmp/audit --keep-zips
 *
 * Requires gcloud + gsutil, already authenticated.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const KEEP_ZIPS = argv.includes('--keep-zips');
const REGION = arg('--region', 'us-central1');

function defaultProject() {
  try {
    const rc = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '.firebaserc'), 'utf8'));
    return rc.projects && rc.projects.default;
  } catch {
    return null;
  }
}

const PROJECT = arg('--project', defaultProject());
if (!PROJECT) {
  console.error('No project. Pass --project <id> or add one to .firebaserc.');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(arg('--out', path.join('docs', `deployed-sources-${stamp}`)));

// ── helpers ───────────────────────────────────────────────────────────
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const shQuiet = (cmd, args) => {
  try {
    return sh(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

function projectNumber(projectId) {
  const out = shQuiet('gcloud', ['projects', 'describe', projectId, '--format=value(projectNumber)']);
  return out.trim();
}

/** Every live function, with the fields we need to locate its source. */
function listFunctions() {
  const raw = shQuiet('gcloud', [
    'functions', 'list',
    '--project', PROJECT,
    '--format=json',
  ]);
  if (!raw.trim()) return [];
  return JSON.parse(raw).map((f) => ({
    name: f.name.split('/').pop(),
    // 2nd gen reports environment: GEN_2; 1st gen leaves it blank.
    gen: f.environment === 'GEN_2' ? 2 : 1,
    trigger: (f.eventTrigger && (f.eventTrigger.eventType || f.eventTrigger.event)) || 'https',
    updated: (f.updateTime || '').slice(0, 10),
    runtime: (f.buildConfig && f.buildConfig.runtime) || f.runtime || '',
  }));
}

/**
 * Locate the newest archive for a function.
 *
 * 1st gen: gs://gcf-sources-<num>-<region>/<fn>-<uuid>/version-N/function-source.zip
 * 2nd gen: gs://gcf-v2-sources-<num>-<region>/<fn>/function-source.zip
 *
 * The uuid is not derivable, so the prefix is listed rather than guessed, and
 * version directories are sorted numerically — version-10 must beat version-9.
 */
function archiveUri(fn, num) {
  const bucket = fn.gen === 2
    ? `gs://gcf-v2-sources-${num}-${REGION}`
    : `gs://gcf-sources-${num}-${REGION}`;

  const dirs = shQuiet('gsutil', ['ls', `${bucket}/`])
    .split('\n')
    .filter((l) => l.includes(`/${fn.name}-`) || l.endsWith(`/${fn.name}/`));
  if (dirs.length === 0) return null;

  // A function redeployed under a new uuid can have several prefixes; the
  // last one listed is the most recent deploy.
  const prefix = dirs[dirs.length - 1].trim();

  const versions = shQuiet('gsutil', ['ls', prefix])
    .split('\n')
    .filter((l) => /version-\d+\/$/.test(l))
    .sort((a, b) => {
      const n = (s) => parseInt((s.match(/version-(\d+)/) || [])[1] || '0', 10);
      return n(a) - n(b);
    });

  const base = versions.length ? versions[versions.length - 1].trim() : prefix;
  return `${base}function-source.zip`;
}

/**
 * Every .js in the repo that could be the source of a deployed function.
 *
 * Which file to expect depends on how the function was deployed, and this
 * project has both styles:
 *   - shared codebase  → the archive's index.js IS functions/index.js
 *   - one folder per function (the older style) → the archive's index.js is
 *     that single function, which lives here under a different name
 * So rather than guessing the filename, every candidate is compared.
 */
function repoCandidates() {
  const roots = ['functions', 'functions/recovered', 'firebase-value-alerts/functions'];
  const out = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const f of fs.readdirSync(root)) {
      if (f.endsWith('.js')) out.push(path.join(root, f));
    }
  }
  return out;
}

/** Compare ignoring trailing whitespace and a missing final newline. */
const normalise = (s) => s.replace(/[ \t]+$/gm, '').replace(/\n+$/, '').trim();

/**
 * Match the deployed entry point against the repo.
 *
 * `contains` rather than only equality: a recovered file may carry an added
 * provenance header above otherwise untouched source, and that is a match,
 * not drift. Reporting it as drift is how a clean repo looks alarming.
 */
function matchAgainstRepo(deployedSrc, fnName) {
  const target = normalise(deployedSrc);
  if (!target) return 'extracted (empty entry point)';

  const candidates = repoCandidates();
  let headerOnly = null;

  for (const file of candidates) {
    let body;
    try { body = normalise(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (body === target) return `matches ${file}`;
    if (!headerOnly && body.length > target.length && body.endsWith(target)) headerOnly = file;
  }
  if (headerOnly) return `matches ${headerOnly} (repo adds a header)`;

  const sameName = candidates.find((f) => path.basename(f, '.js') === fnName);
  return sameName ? `DRIFTED from ${sameName}` : 'NOT IN REPO';
}

// ── run ───────────────────────────────────────────────────────────────
const num = projectNumber(PROJECT);
if (!num) {
  console.error(`Could not resolve the project number for ${PROJECT}. Is gcloud authenticated?`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
console.log(`project ${PROJECT} (${num}), region ${REGION}`);
console.log(`output  ${OUT}\n`);

const fns = listFunctions();
if (fns.length === 0) {
  console.error('No functions returned. Check the project id and your gcloud login.');
  process.exit(1);
}

const rows = [];
for (const fn of fns) {
  const uri = archiveUri(fn, num);
  if (!uri) {
    rows.push({ ...fn, status: 'no archive found' });
    console.log(`✗ ${fn.name}: no source archive in the expected bucket`);
    continue;
  }

  const zip = path.join(OUT, `${fn.name}.zip`);
  const dir = path.join(OUT, fn.name);
  try {
    sh('gsutil', ['-q', 'cp', uri, zip]);
  } catch {
    rows.push({ ...fn, status: 'download failed' });
    console.log(`✗ ${fn.name}: download failed`);
    continue;
  }

  fs.mkdirSync(dir, { recursive: true });
  // -x skips the vendored node_modules, which can be tens of megabytes and
  // are never what you want to read.
  try {
    // stderr is swallowed: unzip warns when -x matches nothing, which is the
    // normal case for an archive that never vendored node_modules.
    sh('unzip', ['-o', '-q', zip, '-d', dir, '-x', 'node_modules/*'],
       { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch { /* partial extraction is still useful */ }
  if (!KEEP_ZIPS) fs.unlinkSync(zip);

  const entry = path.join(dir, 'index.js');
  const status = fs.existsSync(entry)
    ? matchAgainstRepo(fs.readFileSync(entry, 'utf8'), fn.name)
    : 'extracted (no index.js)';

  rows.push({ ...fn, status });
  console.log(`✓ ${fn.name}  ${status}`);
}

// ── summary ───────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`\n${pad('function', 30)} ${pad('gen', 4)} ${pad('updated', 11)} status`);
console.log('-'.repeat(92));
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${pad(r.name, 30)} ${pad(r.gen, 4)} ${pad(r.updated, 11)} ${r.status}`);
}

const missing = rows.filter((r) => r.status === 'NOT IN REPO');
const drifted = rows.filter((r) => String(r.status).startsWith('DRIFTED'));
console.log(`\n${rows.length} live functions.`);
if (missing.length) {
  console.log(`\n⚠️  ${missing.length} have NO source in this repo — they cannot be`);
  console.log('    rebuilt or reviewed from here, and a codebase deploy will not');
  console.log('    recreate them if they are ever deleted:');
  missing.forEach((r) => console.log(`      ${r.name}`));
}
if (drifted.length) {
  console.log(`\n⚠️  ${drifted.length} DRIFTED from the repo copy — what is running is not`);
  console.log('    what the repo says is running:');
  drifted.forEach((r) => console.log(`      ${r.name}  (${r.status})`));
}
if (!missing.length && !drifted.length) {
  console.log('\n✅ every live function matches a source file in this repo.');
}
