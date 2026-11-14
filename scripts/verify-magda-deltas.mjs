/**
 * MAGDA delta gate. MAGDA-DELTAS.json pins the reconstruction commit, whose tree must still
 * reproduce the official 0.1.5 npm packages (scripts/verify-reconstruction.mjs run at that
 * commit), and lists every MAGDA change made after it. Every file that differs between the
 * reconstruction commit and this checkout must belong to a declared delta.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMain, root } from './platform-matrix.mjs';
import { pnpm } from './pack-utils.mjs';

const ledger = 'MAGDA-DELTAS.json';
const always = new Set(['MAGDA.md', ledger]);
// Recorded qualification evidence documents a release; it changes no source, recipe or tooling.
const records = /^qualification\/evidence\//;

function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** @returns undeclared changed files and the parsed ledger, without running the reconstruction gate. */
export function checkDeltas(repo = root) {
  const record = JSON.parse(readFileSync(join(repo, ledger), 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(record.reconstruction ?? '')) throw new Error(`${ledger} must pin a full reconstruction commit`);
  if (spawnSync('git', ['merge-base', '--is-ancestor', record.reconstruction, 'HEAD'], { cwd: repo }).status !== 0)
    throw new Error(`Reconstruction commit ${record.reconstruction} is not an ancestor of HEAD`);
  const ids = new Set();
  const declared = new Set();
  for (const delta of record.deltas ?? []) {
    if (!/^[a-z0-9-]+$/.test(delta.id ?? '') || ids.has(delta.id) || !delta.summary || !Array.isArray(delta.files) || delta.files.length === 0)
      throw new Error(`Invalid or duplicate delta entry: ${delta.id}`);
    ids.add(delta.id);
    for (const file of delta.files) declared.add(file);
  }
  // Committed changes only: local build output (for example a staged packages/wasm) is not part of the branch.
  const committed = new Set(git(['diff', '--name-only', record.reconstruction, 'HEAD', '--'], repo).split('\n').filter(Boolean));
  const undeclared = [...committed].filter(file => !always.has(file) && !records.test(file) && !declared.has(file)).sort();
  const unused = [...declared].filter(file => !committed.has(file)).sort();
  return { record, undeclared, unused };
}

/**
 * Run the reconstruction gate as it exists at the reconstruction commit, in a disposable worktree.
 * @returns that gate's result: compared file counts and an empty difference list.
 */
export function verifyReconstructionCommit(commit, repo = root) {
  const worktree = mkdtempSync(join(tmpdir(), 'kit-reconstruction-'));
  rmSync(worktree, { recursive: true });
  git(['worktree', 'add', '--detach', worktree, commit], repo);
  try {
    pnpm(['install', '--frozen-lockfile'], { cwd: worktree, timeout: 900_000 });
    const output = pnpm(['run', '--silent', 'verify:reconstruction'], { cwd: worktree, timeout: 900_000 });
    const result = JSON.parse(output.slice(output.indexOf('{')));
    if (result.differences.length > 0) throw new Error(`Reconstruction differs: ${result.differences.join(', ')}`);
    return result;
  } finally {
    git(['worktree', 'remove', '--force', worktree], repo);
  }
}

if (isMain(import.meta.url)) {
  const { record, undeclared, unused } = checkDeltas();
  if (undeclared.length > 0) throw new Error(`Files changed since the reconstruction without a ${ledger} entry: ${undeclared.join(', ')}`);
  if (unused.length > 0) throw new Error(`${ledger} lists files that do not differ from the reconstruction: ${unused.join(', ')}`);
  const reconstruction = process.argv.includes('--ledger-only') ? undefined : verifyReconstructionCommit(record.reconstruction);
  console.log(JSON.stringify({ reconstruction: record.reconstruction, verified: reconstruction, deltas: record.deltas.map(delta => delta.id) }, null, 2));
}
