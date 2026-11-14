#!/usr/bin/env node
/**
 * Portable smoke test of an installed LibreOffice Kit: plain Node.js, no Poppler or Python, so it
 * runs on Linux, macOS and Windows. Font-independent results are asserted against values recorded
 * from the official 0.1.5 packages on Linux; font-dependent ones (missing fonts, PDF fonts) are
 * only reported, because each OS has different system fonts.
 * Usage: node qualification/smoke.mjs <kit package directory> <fixtures directory> <output directory>
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [kit, fixtures, out] = process.argv.slice(2).map(path => resolve(path));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const cli = join(kit, 'lib/cli.js');
const { createConverter } = await import(pathToFileURL(join(kit, 'lib/index.js')).href);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fixture = name => join(fixtures, name);
const report = { host: `${process.platform}-${process.arch}`, node: process.version, checks: [] };
function cliJson(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 << 20 });
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr.slice(-800)}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}
async function check(name, body) {
  const started = Date.now();
  try {
    const facts = await body();
    report.checks.push({ name, ok: true, ms: Date.now() - started, ...(facts ? { facts } : {}) });
  } catch (error) {
    report.checks.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 800) });
  }
}

await check('capabilities selects the WASM engine', () => {
  const runtime = cliJson(['capabilities', '--json']).runtime;
  assert.equal(runtime.backend, 'wasm');
  return { version: runtime.version };
});
await check('DOCX to text equals the Linux reference', () => {
  cliJson(['convert', '--input', fixture('magda-report.docx'), '--output', join(out, 'report.txt')]);
  assert.equal(sha(join(out, 'report.txt')), '7d1b265eb1bfb7183570572c5fe98ffde67a014364af4964fd56151f30af9563');
});
await check('XLSX to CSV equals the Linux reference', () => {
  cliJson(['convert', '--input', fixture('magda-budget.xlsx'), '--output', join(out, 'budget.csv'), '--sheet', 'Summary']);
  assert.equal(sha(join(out, 'budget.csv')), 'd30c17e524a9a1a492a65a9ff870d48fbda0f3bdc811b8a9320adcbe86dee165');
});
await check('recalculation computes the missing formula result', () => {
  cliJson(['recalculate', '--input', fixture('magda-uncalculated.xlsx'), '--output', join(out, 'recalculated.xlsx')]);
  cliJson(['convert', '--input', join(out, 'recalculated.xlsx'), '--output', join(out, 'recalculated.csv')]);
  const rows = readFileSync(join(out, 'recalculated.csv'), 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(rows.map(row => row.split(',')[0]), ['2', '3', '6']);
});
await check('PPTX slide renders at the reference geometry', () => {
  const result = cliJson(['render', '--input', fixture('magda-briefing.pptx'), '--output-dir', join(out, 'slide'), '--pages', '1', '--dpi', '72']);
  assert.deepEqual(result.images.map(({ width, height, page }) => ({ width, height, page })), [{ width: 721, height: 541, page: 1 }]);
  assert.deepEqual(readFileSync(join(out, 'slide', 'page-0001.png')).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { missingFonts: result.missingFonts };
});
await check('worksheet range renders as one image', () => {
  const result = cliJson(['render', '--input', fixture('magda-budget.xlsx'), '--output-dir', join(out, 'sheet'), '--sheet', 'Summary', '--range', 'A1:C9', '--dpi', '72']);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].sheet, 'Summary');
  assert.equal(readdirSync(join(out, 'sheet')).filter(name => name.endsWith('.png')).length, 1);
});
await check('preview API renders PDFs and survives cancellation', async () => {
  const converter = await createConverter({ timeoutMs: 180_000 });
  try {
    const signal = () => new AbortController().signal;
    const preview = await converter.render({ inputPath: fixture('magda-report.docx'), outputPath: join(out, 'report.pdf') }, signal());
    assert.equal(readFileSync(join(out, 'report.pdf')).subarray(0, 5).toString(), '%PDF-');
    const missing = await converter.render({ inputPath: fixture('magda-briefing.pptx'), outputPath: join(out, 'briefing.pdf') }, signal());
    const controller = new AbortController();
    const pending = converter.render({ inputPath: fixture('magda-report.docx'), outputPath: join(out, 'cancelled.pdf') }, controller.signal);
    controller.abort(new Error('cancelled by smoke test'));
    await assert.rejects(pending, /cancelled by smoke test/);
    await converter.render({ inputPath: fixture('magda-report.docx'), outputPath: join(out, 'after-cancel.pdf') }, signal());
    return { reportMissingFonts: preview.missingFonts, briefingMissingFonts: missing.missingFonts };
  } finally {
    await converter.dispose();
  }
});
await check('unsupported and corrupt inputs fail with codes', () => {
  const codes = {};
  for (const name of ['magda-truncated.docx', 'magda-legacy.doc']) {
    const result = spawnSync(process.execPath, [cli, 'convert', '--input', fixture(name), '--output', join(out, `${name}.pdf`)], { encoding: 'utf8', timeout: 300_000 });
    assert.notEqual(result.status, 0);
    codes[name] = JSON.parse(result.stderr.trim().split('\n').at(-1)).code;
  }
  assert.deepEqual(codes, { 'magda-truncated.docx': 'invalid-document', 'magda-legacy.doc': 'invalid-document' });
});

console.log(JSON.stringify(report, null, 2));
if (report.checks.some(check => !check.ok)) process.exit(1);
