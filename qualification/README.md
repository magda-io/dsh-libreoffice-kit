# Functional qualification

These scripts check that a LibreOffice Kit release built from this branch behaves like the
official `@deepseek-ai/libreoffice-kit@0.1.5` npm packages. Run them by hand on any Docker host:

```sh
qualification/download-release.sh v0.1.5-magda.1 candidate   # needs gh; drafts need write access
qualification/run-comparison.sh candidate evidence
```

The **MAGDA qualification** workflow (`.github/workflows/magda-qualification.yml`) is a thin
wrapper around those two scripts. You dispatch it manually with a release tag, and it runs them
on native GitHub `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` runners, with one shared fixture
set. It then compares the two architectures' results; that comparison is reported, not
required. Each architecture's evidence is kept as a workflow artifact for 90 days. Commit it
under `evidence/` to keep it for good.

`run-comparison.sh --platform linux/amd64` runs the image under emulation, for example on an
arm64 Mac. That's a convenience check, not qualification of the platform; qualify on a native
host. `--fixtures <dir>` reuses a fixture directory.

| File                                  | Purpose                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures.json`, `fetch-fixtures.mjs` | Downloads fixtures from pinned commits and verifies each SHA-256: 36 LibreOffice Core QA documents (6 each of DOC, DOCX, XLS, XLSX, PPT and PPTX) and MAGDA's Office fixtures. It also generates right-to-left, CJK, missing-font and long documents (`generate_edge_fixtures.py`).   |
| `download-release.sh`                 | Downloads a release's tarballs and `SHA256SUMS` by tag and verifies them                                                                                                                                                                                                              |
| `packages.mjs`                        | Downloads the official 0.1.5 tarballs (pinned sha512), or verifies a release's tarballs against its `SHA256SUMS`                                                                                                                                                                      |
| `run.mjs`                             | Runs one installation over the fixtures: the DSH Web preview API (`createConverter` → `render` → `dispose`), the CLI (`capabilities`, `render`, `convert`, `recalculate`), errors, limits and cancellation                                                                            |
| `compare.py`                          | Compares two result sets case by case                                                                                                                                                                                                                                                 |
| `smoke.mjs`                           | Node-only smoke test for any OS. The workflow's `smoke` job runs it on Linux x64 and arm64, macOS and Windows. It checks that the kit selects WASM, and that text and CSV exports, recalculation, render geometry, preview API cancellation and error codes match the Linux reference |
| `Dockerfile`                          | Debian trixie host with the Agent Runtime's fonts plus Noto CJK, Poppler and Node.js 22                                                                                                                                                                                               |

`compare.py` treats a case as **EQUAL** only when status, error code, page count, extracted
text, embedded and missing fonts, image geometry, recalculated values and exported files all
match, and rendered PNG pixels are identical. It ignores two things:

- installation identity: the version and install paths in `capabilities`;
- LibreOffice's random per-run IDs in ODT exports, which differ between two runs of the same
  official package.

## Reproducing the full comparison and its evidence

`qualification/run-comparison.sh [--platform <os/arch>] [--fixtures <dir>] <candidate dir> <output dir>` reproduces the full comparison
with nothing but Docker on the host. `<candidate dir>` holds a release's two `.tgz` files and
its `SHA256SUMS`. The script runs four sets concurrently over the same fixture files:

- **baseline:** official 0.1.3, built from this branch's public source baseline;
- **reference:** official 0.1.5;
- **reference-rerun:** official 0.1.5 again, as the noise floor;
- **candidate:** the given release.

It writes:

- `sets/<name>/results.json` and the raw PDF, PNG and export outputs;
- `reports/*.json` and `reports/summary.md`: candidate vs reference (strict), rerun vs reference,
  and baseline vs reference;
- `environment.json`: the harness commit, image ID, host, Node.js version, package tarball
  hashes, installed versions, and the fixture manifest plus every fixture file's SHA-256;
- `outputs.sha256` (every raw output) and `comparison-evidence.tar.gz` (all of the above, with
  the fixtures).

Recorded evidence lives in [`evidence/`](evidence/). The raw bundle is attached to the release.

To run the workflow's steps locally, use the same container:

```sh
docker build -t kit-qualification qualification
docker run --rm -e HOME=/tmp -v "$PWD":/work kit-qualification node qualification/fetch-fixtures.mjs fixtures
docker run --rm -e HOME=/tmp -v "$PWD":/work kit-qualification node qualification/packages.mjs reference packages-reference
# Install each set with `npm install --ignore-scripts <dir>/*.tgz`, then:
#   node qualification/run.mjs <install>/node_modules/@deepseek-ai/libreoffice-kit fixtures <out>
#   python3 qualification/compare.py <reference-out> <candidate-out> report.json --strict
```
