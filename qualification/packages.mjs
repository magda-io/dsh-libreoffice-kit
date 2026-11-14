#!/usr/bin/env node
/**
 * Prepare the package tarballs one qualification set installs.
 *   node qualification/packages.mjs reference <dir>  download the official 0.1.5 npm tarballs (pinned sha512)
 *   node qualification/packages.mjs baseline <dir>   download the official 0.1.3 npm tarballs (pinned sha512), the public-source baseline
 *   node qualification/packages.mjs candidate <dir>  verify a release's tarballs against its SHA256SUMS
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reference } from '../scripts/verify-reconstruction.mjs';

const [set, target] = process.argv.slice(2);
const dir = resolve(target ?? 'packages');
mkdirSync(dir, { recursive: true });
const digest = (algorithm, bytes, encoding) => createHash(algorithm).update(bytes).digest(encoding);
// The official 0.1.3 packages, built from the public source this branch starts from.
const baseline = [
  { url: 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit/-/libreoffice-kit-0.1.3.tgz',
    integrity: 'sha512-i85Ll6DAvwI+YGOMtVvPwBSYZso8vz26JlZ+389jxcfoLfRHMXRcW5X/bqyy932GgVNrCUP1Jd7KU/Wy5A8o1g==' },
  { url: 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-wasm/-/libreoffice-kit-wasm-0.1.3.tgz',
    integrity: 'sha512-qWDpBBAcqSqeGd3dk2iucjcxUfbTUGka1n3WGvqgfmL4lqvFA2PY4itopMKW2/PuRpyfoA8ab07FVouCOouECA==' },
];
if (set === 'reference' || set === 'baseline') {
  for (const { url, integrity } of set === 'reference' ? [reference.adapter, reference.wasm] : baseline) {
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`Reference download failed (${response.status}): ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (`sha512-${digest('sha512', bytes, 'base64')}` !== integrity) throw new Error(`Reference integrity mismatch: ${url}`);
    writeFileSync(join(dir, url.split('/').pop()), bytes);
  }
} else if (set === 'candidate') {
  // A release carries its adapter and WASM tarballs and a SHA256SUMS file covering both.
  const sums = new Map(readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n')
    .map(line => /^([0-9a-f]{64}) [ *](\S+)$/.exec(line)).map(match => {
      if (!match) throw new Error('Malformed SHA256SUMS line');
      return [match[2], match[1]];
    }));
  const tarballs = readdirSync(dir).filter(name => name.endsWith('.tgz')).sort();
  const kinds = tarballs.map(name => /^deepseek-ai-libreoffice-kit-wasm-/.test(name) ? 'wasm' : /^deepseek-ai-libreoffice-kit-\d/.test(name) ? 'adapter' : 'other');
  if (JSON.stringify(kinds.sort()) !== JSON.stringify(['adapter', 'wasm'])) throw new Error(`Expected one adapter and one WASM tarball: ${tarballs.join(', ')}`);
  for (const name of tarballs) {
    if (sums.get(name) !== digest('sha256', readFileSync(join(dir, name)), 'hex')) throw new Error(`Checksum mismatch or missing entry: ${name}`);
  }
} else {
  throw new Error('Usage: packages.mjs reference|baseline|candidate <dir>');
}
console.log(`${set} packages ready in ${dir}`);
