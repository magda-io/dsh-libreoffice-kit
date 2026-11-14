#!/usr/bin/env node
/**
 * Run one LibreOffice Kit installation over the fixture set and record comparable results.
 * Usage: node run.mjs <kit package directory> <fixtures directory> <output directory>
 *
 * Exercises the two MAGDA consumers' contracts:
 * - DSH Web preview (office-to-pdf): createConverter() -> render({inputPath, outputPath}, signal) -> dispose();
 * - Office skills: the CLI's capabilities, render, convert and recalculate commands.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';

const [kit, fixtures, out] = process.argv.slice(2).map(p => resolve(p));
const cli = join(kit, 'lib/cli.js');
const { createConverter } = await import(join(kit, 'lib/index.js'));
mkdirSync(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = { kit: JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8')).version, cases: {} };
const record = (name, value) => { results.cases[name] = value; process.stderr.write(`${name}: ${value.ok ? 'ok' : value.code}\n`); };

function pdfFacts(path) {
  const info = spawnSync('pdfinfo', [path], { encoding: 'utf8' });
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1] ?? NaN);
  const text = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout;
  const fonts = spawnSync('pdffonts', [path], { encoding: 'utf8' }).stdout.split('\n').slice(2)
    .map(line => line.split(/\s+/)[0]).filter(Boolean).map(name => name.replace(/^[A-Z]{6}\+/, '')).sort();
  return { pages, textSha256: sha(text.replace(/\s+/g, ' ').trim()), textChars: text.replace(/\s+/g, '').length, fonts: [...new Set(fonts)] };
}

/** ODT parts, with LibreOffice's random per-run revision-session and annotation IDs masked. */
function odtFacts(path) {
  const script = `import hashlib, json, re, sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); out = {}
for name in sorted(z.namelist()):
    data = z.read(name)
    if name.endswith('.xml'):
        text = data.decode()
        text = re.sub(r'(config:name="Rsid(?:Root)?" config:type="int">)[0-9]+', r'\\1N', text)
        text = re.sub(r'__Annotation__[0-9]+_[0-9]+', '__Annotation__N', text)
        data = text.encode()
    out[name] = hashlib.sha256(data).hexdigest()
print(json.dumps(out))`;
  const result = spawnSync('python3', ['-c', script, path], { encoding: 'utf8' });
  if (result.status !== 0) return { odtError: result.stderr.slice(-300) };
  return { parts: JSON.parse(result.stdout) };
}

function runCli(args, timeout = 300_000) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  const ms = Date.now() - started;
  if (result.status === 0) return { ok: true, ms, json: JSON.parse(result.stdout.trim().split('\n').at(-1)) };
  let error = {};
  try { error = JSON.parse(result.stderr.trim().split('\n').at(-1)); } catch { error = { code: result.signal ?? 'crash', error: result.stderr.slice(-500) }; }
  return { ok: false, ms, code: error.code, message: error.error, exit: result.status };
}

const files = readdirSync(fixtures).filter(name => !name.endsWith('.tsv') && !name.endsWith('.json')).sort();

// 1. Skill contract: capabilities.
const caps = runCli(['capabilities', '--json']);
record('capabilities', caps.ok ? { ok: true, ms: caps.ms, value: caps.json } : caps);

// 2. Preview contract: one reused converter, as DSH office-to-pdf does.
let converter = await createConverter({ timeoutMs: 180_000 });
for (const name of files) {
  const output = join(out, 'pdf', `${name}.pdf`);
  mkdirSync(join(out, 'pdf'), { recursive: true });
  const started = Date.now();
  try {
    const result = await converter.render({ inputPath: join(fixtures, name), outputPath: output }, new AbortController().signal);
    record(`preview:${name}`, { ok: true, ms: Date.now() - started, missingFonts: [...result.missingFonts].sort(), ...pdfFacts(output) });
  } catch (error) {
    record(`preview:${name}`, { ok: false, ms: Date.now() - started, code: error?.code ?? error?.name, message: String(error?.message).slice(0, 300) });
    if (error?.code === 'unavailable') { await converter.dispose().catch(() => {}); converter = await createConverter({ timeoutMs: 180_000 }); }
  }
}

// 3. Cancellation and limits through the API, then reuse after cancellation.
{
  const controller = new AbortController();
  const started = Date.now();
  const pending = converter.render({ inputPath: join(fixtures, 'edge-long.docx'), outputPath: join(out, 'cancelled.pdf') }, controller.signal);
  setTimeout(() => controller.abort(new Error('cancelled by test')), 500);
  try { await pending; record('api:cancel', { ok: false, code: 'not-cancelled' }); }
  catch (error) { record('api:cancel', { ok: true, cancelled: error?.message === 'cancelled by test', ms: Date.now() - started }); }
  try {
    const after = await converter.render({ inputPath: join(fixtures, 'magda-report.docx'), outputPath: join(out, 'after-cancel.pdf') }, new AbortController().signal);
    record('api:reuse-after-cancel', { ok: true, missingFonts: after.missingFonts, ...pdfFacts(join(out, 'after-cancel.pdf')) });
  } catch (error) { record('api:reuse-after-cancel', { ok: false, code: error?.code ?? error?.name }); }
}
await converter.dispose();
for (const [name, options, fixture] of [['api:timeout', { timeoutMs: 1 }, 'edge-long.docx'], ['api:max-input-bytes', { maxInputBytes: 1024 }, 'magda-report.docx']]) {
  const limited = await createConverter(options);
  try { await limited.render({ inputPath: join(fixtures, fixture), outputPath: join(out, `${name.slice(4)}.pdf`) }, new AbortController().signal); record(name, { ok: true }); }
  catch (error) { record(name, { ok: false, code: error?.code ?? error?.name }); }
  await limited.dispose();
}

// 4. Skill contract: CLI render, convert and recalculate.
const sheetNames = name => { try { return JSON.parse(spawnSync('python3', ['-c', 'import openpyxl,sys,json; print(json.dumps(openpyxl.load_workbook(sys.argv[1], read_only=True).sheetnames))', name], { encoding: 'utf8' }).stdout); } catch { return []; } };
for (const name of files) {
  const ext = extname(name).slice(1);
  const dir = join(out, 'png', name);
  mkdirSync(join(out, 'png'), { recursive: true });
  const args = ['render', '--input', join(fixtures, name), '--output-dir', dir, '--dpi', '72'];
  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    const first = sheetNames(join(fixtures, name))[0];
    if (first) args.push('--sheet', first, '--range', 'A1:H30'); else args.push('--max-pages', '4');
  } else args.push('--pages', '1');
  const result = runCli(args);
  record(`render:${name}`, result.ok ? { ok: true, ms: result.ms, images: result.json.images.map(image => ({
    file: basename(image.path), width: image.width, height: image.height, page: image.page, sheet: image.sheet, range: image.range, rtl: image.rtl })),
    missingFonts: [...(result.json.missingFonts ?? [])].sort() } : result);
}
for (const name of ['magda-uncalculated.xlsx', 'magda-shared-formulas.xlsx', 'edge-rtl.xlsx', 'magda-legacy.xls', 'magda-strict-shared-formulas.xlsx']) {
  const output = join(out, 'recalc', name.replace(/\.xls$/, '.xlsx'));
  mkdirSync(join(out, 'recalc'), { recursive: true });
  const result = runCli(['recalculate', '--input', join(fixtures, name), '--output', output]);
  if (!result.ok) { record(`recalculate:${name}`, result); continue; }
  const values = spawnSync('python3', ['-c', `import openpyxl,sys,json
wb=openpyxl.load_workbook(sys.argv[1], data_only=True)
print(json.dumps({ws.title:[[c.value if not hasattr(c.value,'isoformat') else c.value.isoformat() for c in row] for row in ws.iter_rows(max_row=60,max_col=20)] for ws in wb.worksheets}, default=str))`, output], { encoding: 'utf8' });
  record(`recalculate:${name}`, { ok: values.status === 0, valuesSha256: sha(values.stdout), values: values.status === 0 ? JSON.parse(values.stdout) : values.stderr.slice(-300) });
}
for (const [name, args] of [['convert:report.txt', ['--input', join(fixtures, 'magda-report.docx'), '--output', join(out, 'report.txt')]],
  ['convert:budget.csv', ['--input', join(fixtures, 'magda-budget.xlsx'), '--output', join(out, 'budget.csv'), '--sheet', sheetNames(join(fixtures, 'magda-budget.xlsx'))[0] ?? 'Sheet1']],
  ['convert:report.odt', ['--input', join(fixtures, 'magda-report.docx'), '--output', join(out, 'report.odt')]],
  ['convert:briefing.pdf', ['--input', join(fixtures, 'magda-briefing.pptx'), '--output', join(out, 'briefing.pdf')]],
  ['convert:missing-sheet.csv', ['--input', join(fixtures, 'magda-budget.xlsx'), '--output', join(out, 'missing.csv'), '--sheet', 'No Such Sheet']]]) {
  const result = runCli(['convert', ...args]);
  const output = args[args.indexOf('--output') + 1];
  const facts = !result.ok ? {} : output.endsWith('.pdf') ? pdfFacts(output)
    : output.endsWith('.odt') ? odtFacts(output) : { sha256: sha(readFileSync(output)) };
  record(name, result.ok ? { ok: true, ms: result.ms, ...facts } : result);
}
writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
