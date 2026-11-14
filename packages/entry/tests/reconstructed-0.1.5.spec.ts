/**
 * Regression tests for behaviour reconstructed from the published 0.1.4/0.1.5
 * npm bundles: right-to-left worksheet tiles and the non-Windows native spawn path.
 */
import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { ChildProcess } from 'node:child_process'
import { unmirrorRtlTile } from '../src/rendering.ts'
import { spawnNative } from '../src/native-process.ts'
import { renderImagesWithWasm } from '../src/image-renderer.ts'
import { resolveImageRender } from '../src/image-operations.ts'
import { resolveOptions } from '../src/options.ts'
import type { WasmEngine } from '../src/engine.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

/** Red channel of every pixel, row by row, from a PNG written by encodePng (filter type 1). */
function redChannel(png: Uint8Array): number[][] {
  const buffer = Buffer.from(png)
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20)
  const idat: Buffer[] = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rows: number[][] = []
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1)
    expect(raw[start]).toBe(1)
    const row: number[] = []
    for (let x = 0; x < width * 4; x++) row.push((raw[start + 1 + x]! + (x >= 4 ? row[x - 4]! : 0)) & 255)
    rows.push(row.filter((_, index) => index % 4 === 0))
  }
  return rows
}

it('mirrors each tile row in place, keeps odd centre columns and restores on a second pass', () => {
  const rgba = Uint8ClampedArray.from({ length: 3 * 2 * 4 }, (_, index) => index)
  const original = Uint8ClampedArray.from(rgba)
  unmirrorRtlTile({ width: 3, height: 2, rgba })
  expect([...rgba]).toEqual([8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3, 20, 21, 22, 23, 16, 17, 18, 19, 12, 13, 14, 15])
  unmirrorRtlTile({ width: 3, height: 2, rgba })
  expect(rgba).toEqual(original)
})

async function wasmSheetFixture(rtl: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'kit-rtl-')); roots.push(root)
  const outputDir = join(root, 'images'); await mkdir(outputDir)
  const loader = join(root, 'loader.cjs')
  // A worksheet whose painted transport pixels carry their column index in the red channel.
  await writeFile(loader, `module.exports = async function factory(options) {
  const memory = new Uint32Array(100000)
  const strings = new Map(); let nextString = 8, next = 1024
  const text = value => { const p = nextString++; strings.set(p, value); return p }
  const module = { FS: { mkdirTree() {}, writeFile() {}, readFile() { throw Error('no export') } }, ENV: {}, HEAPU32: memory,
    UTF8ToString(p) { return strings.get(p) }, PThread: { terminateAllThreads() {} },
    ccall(name, ret, types, args) {
      if (name === 'malloc') { const p = next; next += Math.ceil(args[0] / 4) * 4; return p }
      if (name === 'dsh_lok_initialize') return 1
      if (name === 'dsh_lok_document_load') return 2
      if (name === 'dsh_lok_document_type') return 1
      if (name === 'dsh_lok_document_parts') return 1
      if (name === 'dsh_lok_document_part_info') return text(JSON.stringify({ name: 'Data', visible: 1, rtllayout: ${rtl ? 1 : 0}, lastcolumn: 2, lastrow: 0 }))
      if (name === 'dsh_lok_document_command_values') {
        if (args[1] === '.uno:AllPageSize') return text(JSON.stringify({ parts: [{ width: 450, height: 150 }] }))
        if (args[1] === '.uno:SheetGeometryData') return text(JSON.stringify({ columns: { sizes: '150:16383', hidden: '0:16383', filtered: '0:16383' }, rows: { sizes: '150:1048575', hidden: '0:1048575', filtered: '0:1048575' } }))
        return text('{}')
      }
      if (name === 'dsh_lok_document_command') options.dshOnCallback(16, JSON.stringify({ commandName: args[1], idleID: 'node-raster' }))
      if (name === 'dsh_lok_document_paint') {
        const [, p, , w, h] = args; const pixels = new Uint8Array(memory.buffer, p, w * h * 4)
        for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = (i / 4) % w; pixels[i + 3] = 255 }
      }
      if (name === 'dsh_lok_document_tile_mode') return 1
      return 1
    } }
  options.preRun.forEach(hook => hook(module)); return module
}`)
  await writeFile(join(root, 'soffice.data'), '')
  const engine: WasmEngine = { backend: 'wasm', root, loader, data: join(root, 'soffice.data'), wasm: join(root, 'dsh-office.wasm'), metadata: join(root, 'soffice.data.js.metadata'), programDirectory: '/instdir/program' }
  return renderImagesWithWasm({ engine, extension: 'xlsx', bytes: new TextEncoder().encode('document'),
    options: resolveOptions({ fontDirectories: [], fontFallbacks: [] }), document: { families: new Map<string, string>(), codePoints: [] }, faces: [],
    operation: resolveImageRender({ inputPath: join(root, 'in.xlsx'), outputDir, sheet: 'Data', range: 'A1:C1', dpi: 96 }) })
}

it('WASM worksheet images undo transport mirroring only for right-to-left sheets', async () => {
  const ltr = await wasmSheetFixture(false)
  const rtl = await wasmSheetFixture(true)
  expect(ltr.images[0]).toMatchObject({ sheet: 'Data', range: 'A1:C1', width: 30, height: 10 })
  expect(rtl.images[0]).toMatchObject({ sheet: 'Data', range: 'A1:C1', width: 30, height: 10, rtl: true })
  const columns = Array.from({ length: 30 }, (_, x) => x)
  for (const row of redChannel(await readFile(ltr.images[0]!.path))) expect(row).toEqual(columns)
  for (const row of redChannel(await readFile(rtl.images[0]!.path))) expect(row).toEqual(columns.toReversed())
})

it.skipIf(process.platform === 'win32')('spawnNative uses an ordinary piped child process outside Windows', async () => {
  const child = spawnNative(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { PATH: process.env.PATH ?? '' })
  expect(child).toBeInstanceOf(ChildProcess)
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
  child.stdin.end('helper protocol\n')
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => child.once('close', (...result) => resolve(result as [number | null, NodeJS.Signals | null])))
  expect({ code, signal, output, exitCode: child.exitCode }).toEqual({ code: 0, signal: null, output: 'helper protocol\n', exitCode: 0 })
})
