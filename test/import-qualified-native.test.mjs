import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeImports } from '../scripts/import-qualified-native.mjs';
import { sourceRepository } from '../scripts/platform-matrix.mjs';

// MAGDA releases no native engines, so the default release declaration imports none; the
// source checks are exercised with an explicit native release declaration.
const windows = ['win32-x64', 'win32-arm64'];
const successful = { repository: { full_name: sourceRepository }, status: 'completed', conclusion: 'success',
  path: '.github/workflows/libreoffice-kit-import-native.yml' };

test('imports both verified Windows architectures without selecting unchanged platforms', () => {
  assert.throws(() => nativeImports('{"win32-x64":"123"}', () => successful), /Invalid native platform/);
  assert.deepEqual(nativeImports('{"win32-x64":"123","win32-arm64":"456"}', () => successful, windows),
    [{ platform: 'win32-x64', id: '123' }, { platform: 'win32-arm64', id: '456' }]);
  assert.deepEqual(nativeImports('{}', () => { throw new Error('unexpected lookup'); }), []);
});

test('rejects invalid selections and failed, foreign or unverified artifact sources', () => {
  for (const value of ['null', '[]', '{"wasm":"123"}', '{"win32-x64":"1;echo"}', '{"win32-x64":123}'])
    assert.throws(() => nativeImports(value, () => successful, windows));
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { repository: { full_name: 'another/repo' } },
    { path: '.github/workflows/arbitrary-upload.yml' }])
    assert.throws(() => nativeImports('{"win32-x64":"123"}', () => ({ ...successful, ...change }), windows), /successful build or verified import/);
});
