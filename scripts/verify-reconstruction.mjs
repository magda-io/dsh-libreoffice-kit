/**
 * MAGDA reconstruction gate: the adapter built from this checkout must equal the
 * official @deepseek-ai/libreoffice-kit@0.1.5 npm package byte for byte, and the
 * engine recipe must equal the recipe shipped in @deepseek-ai/libreoffice-kit-wasm@0.1.5.
 * The only accepted differences are this branch's release identity: its
 * version (0.1.5-magda.1), its repository URL and the release repository name
 * used by the publication tooling. Official archives are
 * comparison fixtures only; nothing from them is copied into the build.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildKitSources } from './build-kit.mjs';
import { isMain, root } from './platform-matrix.mjs';

export const reference = Object.freeze({
  version: '0.1.5',
  adapter: {
    url: 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit/-/libreoffice-kit-0.1.5.tgz',
    integrity: 'sha512-H12xtUsAyl70zFeQ5pk5GGRc3N1+6zn+DVAcqwlguI6EvqopBGP3xkUmePU7g5f6ydYlDZLWedHT9lTSL7zLxA==',
  },
  wasm: {
    url: 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-wasm/-/libreoffice-kit-wasm-0.1.5.tgz',
    integrity: 'sha512-V+pu5xJsKhVD4AU1xbFlMWY91svK9ZIC2JsNOph9kWp/arF/KQcuytt76bcbozJqPbE8o0n04lyh0m3QW5RYSA==',
  },
});
const upstreamRepository = 'https://github.com/deepseek-ai/dsh-libreoffice-kit';
const upstreamReleaseRepository = 'deepseek-harness/libreoffice-kit';

/** Map this branch's release identity back to the reference identity. */
export function normalizeIdentity(text, version) {
  return text.replaceAll(version, reference.version)
    .replaceAll('https://github.com/magda-io/dsh-libreoffice-kit', upstreamRepository)
    .replaceAll(`'magda-io/dsh-libreoffice-kit'`, `'${upstreamReleaseRepository}'`);
}

async function fetchReference({ url, integrity }, directory) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`Reference download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== integrity) throw new Error(`Reference integrity mismatch for ${url}`);
  const archive = join(directory, 'package.tgz');
  writeFileSync(archive, bytes);
  const result = spawnSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Cannot extract ${url}`);
  return join(directory, 'package');
}

function files(directory) {
  const out = [];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.push(relative(directory, path));
    }
  };
  visit(directory);
  return out.sort();
}

/** Compare package manifests after pnpm pack's workspace:* substitution and the release identity. */
function compareManifest(referenceDirectory, localPath, version) {
  const expected = JSON.parse(readFileSync(join(referenceDirectory, 'package.json'), 'utf8'));
  const local = JSON.parse(normalizeIdentity(readFileSync(localPath, 'utf8'), version));
  const optional = local.optionalDependencies;
  if (optional) local.optionalDependencies = Object.fromEntries(Object.keys(optional).map(name => [name, expected.optionalDependencies?.[name]]));
  const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const workspaceRanges = Object.values(optional ?? {}).every(range => range === 'workspace:*');
  return canonical(expected) === canonical(local) && workspaceRanges;
}

export async function verifyReconstruction({ build = true } = {}) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const scratch = mkdtempSync(join(tmpdir(), 'kit-reconstruction-'));
  const differences = [];
  try {
    const adapter = await fetchReference(reference.adapter, mkdtempSync(join(scratch, 'adapter-')));
    const wasm = await fetchReference(reference.wasm, mkdtempSync(join(scratch, 'wasm-')));
    const entry = build ? buildKitSources().directory : join(root, 'packages/entry');
    let adapterFiles = 0;
    for (const name of files(adapter)) {
      if (name === 'package.json') {
        if (!compareManifest(adapter, join(entry, 'package.json'), version)) differences.push(`adapter ${name}`);
        continue;
      }
      adapterFiles++;
      let local;
      try { local = readFileSync(join(entry, name)); } catch { differences.push(`adapter ${name} (missing)`); continue; }
      if (!Buffer.from(normalizeIdentity(local.toString('latin1'), version), 'latin1').equals(readFileSync(join(adapter, name))))
        differences.push(`adapter ${name}`);
    }
    // The engine recipe: every shipped source file except build-generated receipts.
    const generated = new Set(['sources/core-source.json', 'sources/build-autogen.input', 'sources/source-changes.patch']);
    let recipeFiles = 0;
    for (const name of files(wasm).filter(name => name.startsWith('sources/') && !generated.has(name))) {
      recipeFiles++;
      let local;
      try { local = readFileSync(join(root, name.slice('sources/'.length))); } catch { differences.push(`recipe ${name} (missing)`); continue; }
      if (!Buffer.from(normalizeIdentity(local.toString('latin1'), version), 'latin1').equals(readFileSync(join(wasm, name))))
        differences.push(`recipe ${name}`);
    }
    if (!compareManifest(wasm, join(root, 'packages/wasm/package.json'), version)) differences.push('wasm package.json');
    const core = JSON.parse(readFileSync(join(wasm, 'sources/core-source.json'), 'utf8'));
    const gitlink = spawnSync('git', ['ls-files', '--stage', '--', 'engine/core'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    if (!gitlink.startsWith(`160000 ${core.revision} `)) differences.push('engine/core pin');
    return { version, reference: reference.version, adapterFiles, recipeFiles, differences };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const result = await verifyReconstruction({ build: !process.argv.includes('--no-build') });
  console.log(JSON.stringify(result, null, 2));
  if (result.differences.length > 0) process.exit(1);
}
