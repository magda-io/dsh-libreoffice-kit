# Functional comparison evidence: 0.1.5-magda.1 on Linux arm64

This is the recorded output of `qualification/run-comparison.sh`, run on 2026-11-14 from a clean
checkout of harness commit `83c94dc2710108ab875a25d9e760bb91b91b6e89`, on a linux/arm64 Docker
host (Debian trixie image, Node.js 22.23.5). `environment.json` holds the full details: image
ID, kernel, package tarball hashes, installed versions, and the SHA-256 of every fixture,
including the generated edge cases.

| Set               | Packages                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `baseline`        | Official `@deepseek-ai/libreoffice-kit(-wasm)@0.1.3`                                                              |
| `reference`       | Official `@deepseek-ai/libreoffice-kit(-wasm)@0.1.5`                                                              |
| `reference-rerun` | The same official 0.1.5 installation, run again                                                                   |
| `candidate`       | `0.1.5-magda.1` from release `v0.1.5-magda.1`: adapter `7dd10e35…`, WASM `eb12e95a…`, engine build ID `663e3304…` |

## Results

| Comparison                              | Result                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| candidate vs official 0.1.5 (strict)    | **123 of 123 cases EQUAL**                                                               |
| official 0.1.5: second run vs first run | 123 of 123 EQUAL (noise floor)                                                           |
| official 0.1.3 vs official 0.1.5        | 122 EQUAL; `render:edge-rtl.xlsx` differs in pixels: 0.1.5's right-to-left worksheet fix |

A case is EQUAL only when all of these match, with PNG pixels identical:

- status and error code;
- PDF page count, extracted text, embedded fonts and missing fonts;
- image geometry;
- recalculated cell values;
- exported files.

Ignored are installation identity (version and install paths in `capabilities`) and
LibreOffice's random per-run IDs in ODT exports.

The 123 cases cover:

- **Fixtures:** 36 LibreOffice Core QA documents (6 each of DOC, DOCX, XLS, XLSX, PPT and PPTX),
  MAGDA's Office fixtures, and generated right-to-left, CJK, missing-font and long documents.
- **Operations:**
  - DSH Web's preview API (`createConverter` → `render` → `dispose`, with one reused converter);
  - the CLI's `capabilities`, `render`, `convert` and `recalculate`;
  - error codes, the timeout and input-size limits;
  - cancellation, followed by reuse of the same converter.

## Files

- `reports/summary.md`, `reports/*.json`: per-case verdicts. Each DIFFERENT case includes both
  sides' facts.
- `sets/<set>/results.json`: everything `run.mjs` recorded per case, including timings, page
  counts, text hashes, fonts, image geometry, recalculated values and error codes.
- `outputs.sha256`: SHA-256 of all 628 raw outputs (PDF, PNG, exports).
- `environment.json`.

The raw outputs (PDFs, PNGs, exports), the fixtures and the run logs are in
`comparison-evidence-0.1.5-magda.1-linux-arm64.tar.gz` (sha256
`7baf9cb4aa75c0830eea083af56bdb8a7e7e55b0e0899ac0ca3744a8d74de456`). It's attached to the
`v0.1.5-magda.1` release.

## Re-examining or re-running

```sh
# Check the raw bundle against this record, then re-derive the reports from it.
mkdir bundle && tar -C bundle -xzf comparison-evidence-0.1.5-magda.1-linux-arm64.tar.gz
(cd bundle && sha256sum -c ../qualification/evidence/0.1.5-magda.1-linux-arm64/outputs.sha256)
docker build -t kit-qualification qualification
docker run --rm -v "$PWD":/work -w /work kit-qualification \
  python3 qualification/compare.py bundle/sets/reference bundle/sets/candidate report.json --strict

# Re-run everything from scratch with the release's tarballs and SHA256SUMS in ./candidate:
qualification/run-comparison.sh candidate new-evidence
```

A re-run should reproduce every verdict. Timings and absolute paths differ between hosts.
