#!/usr/bin/env node
/**
 * Download the qualification fixtures listed in fixtures.json from their pinned commits,
 * verify each SHA-256, and generate the edge-case documents.
 * Usage: node qualification/fetch-fixtures.mjs <output directory> [--no-generate]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'fixtures');
const manifest = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
mkdirSync(out, { recursive: true });
for (const fixture of manifest.fixtures) {
  const source = manifest.sources[fixture.source];
  const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${fixture.path}`;
  let bytes;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { redirect: 'error' });
    if (response.ok) { bytes = Buffer.from(await response.arrayBuffer()); break; }
    if (attempt === 4) throw new Error(`Fixture download failed (${response.status}): ${url}`);
    await new Promise(done => setTimeout(done, attempt * 2000));
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== fixture.sha256) throw new Error(`Fixture checksum mismatch: ${fixture.name}`);
  writeFileSync(join(out, fixture.name), bytes);
}
// --no-generate skips the edge cases, which need python-docx and openpyxl (the portable smoke test does not use them).
if (!process.argv.includes('--no-generate')) {
  const generated = spawnSync('python3', [join(here, 'generate_edge_fixtures.py'), out], { stdio: 'inherit' });
  if (generated.status !== 0) throw new Error('Edge-case fixture generation failed');
}
console.log(`${manifest.fixtures.length} fixtures downloaded to ${out}`);
