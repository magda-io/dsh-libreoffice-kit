import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, createWriteStream, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'

/** The helper owner observes closure only after both output pipes finish. */
export interface NativeChild extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal: NodeJS.Signals): boolean
}

interface OwnedPipe { read: number; write: number; readable: Readable }

/** Native helper stdio; Windows pipe handles permit read/write access under restricted tokens. */
let pipeAttributes: any
function windowsPipes(): { pipe: () => OwnedPipe } {
  const koffi = createRequire(import.meta.url)('koffi')
  const kernel = koffi.load('kernel32.dll'), advapi = koffi.load('advapi32.dll'), node = koffi.load(null)
  const attributes = pipeAttributes ??= koffi.struct('KIT_SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void *',
    bInheritHandle: 'int',
  })
  const createPipe = kernel.func('int __stdcall CreatePipe(_Out_ void **read, _Out_ void **write, KIT_SECURITY_ATTRIBUTES *attributes, uint32 size)')
  const closeHandle = kernel.func('int __stdcall CloseHandle(void *handle)')
  const localFree = kernel.func('void * __stdcall LocalFree(void *memory)')
  const peek = kernel.func('int __stdcall PeekNamedPipe(void *pipe, void *buffer, uint32 size, void *read, _Out_ uint32 *available, void *remaining)')
  const lastError = kernel.func('uint32 __stdcall GetLastError()')
  const convertSecurityDescriptor = advapi.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(void *sddl, uint32 revision, _Out_ void **descriptor, void *size)')
  const openFd = node.func('int uv_open_osfhandle(void *handle)')
  function pipe(): OwnedPipe {
    const reads: [unknown] = [null], writes: [unknown] = [null]
    const descriptor: [unknown] = [null]
    if (!convertSecurityDescriptor(Buffer.from('D:(A;;GRGW;;;WD)\0', 'utf16le'), 1, descriptor, null)) throw new Error(`Pipe security descriptor failed: ${lastError()}`)
    try {
      if (!createPipe(reads, writes, { nLength: attributes.size, lpSecurityDescriptor: descriptor[0], bInheritHandle: 0 }, 0)) throw new Error(`CreatePipe failed: ${lastError()}`)
    } finally {
      localFree(descriptor[0])
    }
    const read: number = openFd(reads[0])
    if (read < 0) {
      closeHandle(reads[0])
      closeHandle(writes[0])
      throw new Error('Cannot open anonymous input descriptor')
    }
    const write: number = openFd(writes[0])
    if (write < 0) {
      closeSync(read)
      closeHandle(writes[0])
      throw new Error('Cannot open anonymous output descriptor')
    }
    let timer: NodeJS.Timeout | undefined
    let ended = false
    const readable = new Readable({
      read() { if (timer === undefined && !ended) poll() },
      destroy(error, callback) {
        ended = true
        clearTimeout(timer)
        try {
          closeSync(read)
          callback(error)
        } catch (cause) {
          callback(error ?? cause as Error)
        }
      },
    })
    function poll(): void {
      timer = undefined
      try {
        const available: [number] = [0]
        if (!peek(reads[0], null, 0, null, available, null)) {
          const code: number = lastError()
          if (code !== 109) throw new Error(`PeekNamedPipe failed: ${code}`)
          ended = true
          readable.push(null)
          return
        }
        if (available[0] > 0) {
          const buffer = Buffer.allocUnsafe(Math.min(available[0], 65_536))
          const count = readSync(read, buffer, 0, buffer.length, null)
          if (!readable.push(buffer.subarray(0, count))) return
        }
        timer = setTimeout(poll, 5)
      } catch (error) {
        readable.destroy(error as Error)
      }
    }
    return { read, write, readable }
  }
  return { pipe }
}

/**
 * Spawn with inherited token and Job restrictions; pipe creation never requests a new sandbox policy.
 * @param executable - Verified native helper executable.
 * @param args - Helper protocol arguments.
 * @param env - Filtered operation environment.
 * @returns Helper streams and process lifetime, with output drained before close.
 */
export function spawnNative(executable: string, args: string[], env: NodeJS.ProcessEnv): NativeChild {
  if (process.platform !== 'win32') return spawn(executable, args, { stdio: 'pipe', windowsHide: true, env })
  const { pipe } = windowsPipes()
  const owned: OwnedPipe[] = []
  let child: ChildProcess
  try {
    const input = pipe()
    owned.push(input)
    const output = pipe()
    owned.push(output)
    const error = pipe()
    owned.push(error)
    child = spawn(executable, args, { stdio: [input.read, output.write, error.write], windowsHide: true, env })
  } catch (error) {
    for (const entry of owned) {
      entry.readable.destroy()
      closeSync(entry.write)
    }
    throw error
  }
  const [input, output, error] = owned as [OwnedPipe, OwnedPipe, OwnedPipe]
  input.readable.destroy()
  closeSync(output.write)
  closeSync(error.write)
  const stdin = createWriteStream('', { fd: input.write, autoClose: true })
  const helper = new class extends EventEmitter implements NativeChild {
    stdin = stdin
    stdout = output.readable
    stderr = error.readable
    get exitCode() { return child.exitCode }
    get signalCode() { return child.signalCode }
    kill(signal: NodeJS.Signals) { return child.kill(signal) }
  }()
  let failure: unknown
  const fail = (cause: unknown) => {
    failure ??= cause
    child.kill('SIGKILL')
  }
  stdin.on('error', fail)
  output.readable.on('error', fail)
  error.readable.on('error', fail)
  const drained = Promise.allSettled([finished(stdin), finished(output.readable), finished(error.readable)])
  child.once('error', (cause) => { failure ??= cause })
  child.once('close', (code, signal) => {
    stdin.destroy()
    output.readable.resume()
    error.readable.resume()
    drained.then(() => {
      if (failure !== undefined) helper.emit('error', failure)
      helper.emit('close', code, signal)
    })
  })
  return helper
}
