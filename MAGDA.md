# MAGDA reconstruction of LibreOffice Kit 0.1.5

This `magda/0.1.5` branch is maintained by the [MAGDA](https://github.com/magda-io/magda)
project. It is a **reconstruction**. It is not upstream's 0.1.5 Git history, and the TypeScript
here is not upstream's original source text.

- **Baseline:** the public upstream source at
  [`b19bb73`](https://github.com/magda-io/dsh-libreoffice-kit/commit/b19bb73c74ed893b8a5d1716d32df32a113ed31b),
  which declares version 0.1.3. `master` keeps that baseline unchanged.
- **Target:** the behaviour of the official npm packages `@deepseek-ai/libreoffice-kit@0.1.5`
  and `@deepseek-ai/libreoffice-kit-wasm@0.1.5`, the versions DeepSeek Harness 0.2.1-alpha.1
  depends on. Their 0.1.4 and 0.1.5 source has not been published.
- **Release identity:** `0.1.5-magda.1`, for the adapter and the Linux WASM engine only. It is a
  semver prerelease, so consumers must pin it exactly.

## Provenance

| Component                                                                                                                                                                                                                          | Origin                                                                                                                                               | How it is verified                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Everything not listed below                                                                                                                                                                                                        | Public upstream source at `b19bb73` (0.1.3)                                                                                                          | Git history                                                                                      |
| WASM recipe changes (`engine/ui-resource-policy.mjs`, `docs/ui-resources.md`, `packages/wasm/package.json`)                                                                                                                        | Copied byte for byte from the `sources/` and package root of the official `libreoffice-kit-wasm@0.1.5` npm archive                                   | `pnpm run verify:reconstruction`                                                                 |
| Adapter changes (`packages/entry/src/native-process.ts` and edits to `engine`, `native`, `native-image-renderer`, `image-renderer`, `rendering`, `sheet-geometry`), READMEs, manifest                                              | Reconstructed TypeScript, written from the readable published 0.1.4/0.1.5 bundles and declarations. Private names and type annotations are inferred. | `pnpm run verify:reconstruction`: all 40 published adapter files are byte-identical to the build |
| MAGDA additions (`MAGDA.md`, `scripts/verify-reconstruction.mjs`, `packages/entry/tests/reconstructed-0.1.5.spec.ts`, `engine/wasm-source/container/`, `.github/workflows/magda-reconstruction.yml`, the `0.1.5-magda.1` identity) | MAGDA                                                                                                                                                | Review and CI                                                                                    |
| `soffice.wasm`, `soffice.data`, `soffice.cjs`                                                                                                                                                                                      | Compiled by MAGDA from the recipe in this tree. No upstream binary is copied.                                                                        | Build receipt (`assets/manifest.json`) and the comparison below                                  |

The official npm archives serve only as comparison fixtures. `scripts/verify-reconstruction.mjs`
downloads them, checks their pinned sha512 integrity and compares; nothing from them enters a
build.

What the reconstruction changes from 0.1.3:

- **Windows native helpers:** `spawnNative()` uses `koffi` for anonymous pipes with an explicit
  security descriptor. `koffi@3.1.1` becomes a dependency, loaded only on win32.
- **Native helper environment:** adds `SAL_DISABLE_PRINTERLIST=1` and
  `SAL_DISABLE_DEFAULTPRINTER=1`.
- **Right-to-left worksheets:** `unmirrorRtlTile()` makes rendered images readable, in both the
  native and WASM renderers.
- **UI resources:** the policy also retains `svt/ui/tabbuttonsmirrored.ui`.

On Linux, the RTL un-mirroring is the only behaviour change. Upstream's own tests for these
changes aren't public; `packages/entry/tests/reconstructed-0.1.5.spec.ts` covers them.

## Building the engine

```sh
docker build -t magda-lokit-wasm-builder engine/wasm-source/container
docker volume create lokit-wasm-build
docker run --rm -v lokit-wasm-build:/build/libreoffice-kit magda-lokit-wasm-builder \
  https://github.com/magda-io/dsh-libreoffice-kit.git <full commit> <jobs>
```

The staged package is written to `packages/wasm` in the volume's workspace, and
`pnpm pack` packs it.

Measured on linux/arm64 (Docker Desktop VMs):

- **Compilation:** about 70 minutes with 5 jobs.
- **Final link:** the full-LTO `wasm-ld` link is a single process that peaked at about 22 GiB, so
  give the builder at least 24 GiB of memory. A 14 GiB VM was killed during the link.
- **amd64:** not built yet.

## Comparison with the official 0.1.5 packages

The first candidate engine was built from this branch (build ID `663e3304…`) and compared with
official `libreoffice-kit-wasm@0.1.5`.

- **Build receipt:**
  - Same LibreOffice tag and commit, emsdk 4.0.10, shim, operations header and all 18 patches.
  - The recorded `emcc` banner matches upstream's exactly (`b7dc6e57…`).
  - Upstream's build-host configuration (`config_host.mk`, parallelism) isn't public, so those
    hashes differ.
- **Package files:**
  - 42 of the package's 49 files are byte-identical, including the 47 KB `source-changes.patch`,
    the `soffice.cjs` loader, `soffice.data.js.metadata` and all licence files.
  - `build-autogen.input` differs only in `--with-parallelism`.
- **`soffice.data`:** the same 1,312 resources, identical except build timestamps inside
  `presets/autotext/mytexts.bau` (identical CRCs).
- **`soffice.wasm`:** structurally identical (types, 126 imports, 325 exports, globals, tables,
  element and data sections), with all 4,305 ICU and 8 break-iterator data items byte-identical.
  21 of 249,356 function bodies differ, each at the same size. Upstream's own 0.1.3 and 0.1.5
  builds of one recipe differ the same way (19 functions); across these builds the differences
  fall within a pool of 31 functions. **Not proven:** semantic equivalence of those functions at
  instruction level. The functional comparison below covers them.
- **Functional comparison:** official 0.1.3, official 0.1.5 (run twice) and this candidate,
  installed from packed tarballs in a Debian trixie container with MAGDA's runtime fonts plus
  Noto CJK, over 54 fixtures:

  - 36 seeded-sample Core QA documents (6 each of DOC, DOCX, XLS, XLSX, PPT and PPTX);
  - MAGDA's Office fixtures;
  - generated right-to-left, CJK, missing-font and long documents.

  It exercises DSH Web's preview contract (`createConverter` → `render` → `dispose`), the CLI
  (`capabilities`, `render`, `convert`, `recalculate`), error codes, input and time limits, and
  cancellation followed by reuse. All 123 cases match official 0.1.5: PDF page counts, text,
  embedded fonts, missing-font lists, PNG pixels, recalculated values and error codes. The only
  exceptions are the version and install path in `capabilities`, and LibreOffice's random
  per-run session IDs in ODT exports, which also differ between two runs of official 0.1.5.
  Official 0.1.3 differs from 0.1.5 only in the right-to-left worksheet image.

These results come from one arm64 build. The **MAGDA qualification** workflow repeats the
functional comparison for any release of this repository on Linux x64 and arm64 (see
[qualification/README.md](qualification/README.md)). gVisor qualification belongs to MAGDA's
runtime tests.

## Not in scope

- **Native engines:** this branch doesn't build or release macOS or Windows engines. The adapter's
  optional dependencies for those platforms still name upstream's published `0.1.5` packages;
  Linux installs skip them.
- **Upstream release tooling:** `scripts/release-*.mjs` and `scripts/publish-npm-release.mjs` are
  unchanged except for the repository name. MAGDA's release process is defined separately.
