# Qualification evidence

## v0.1.5-magda.1

Recorded from **MAGDA qualification**
[run 43597469424](https://github.com/magda-io/dsh-libreoffice-kit/actions/runs/43597469424)
(2026-11-15). The workflow ran on `magda` at `f82a98880acf46ba5c547aa625b14664d3f8ffc7`, the release
commit, with no uncommitted changes. It qualified the release's own assets:

| Asset                                                | sha256                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `deepseek-ai-libreoffice-kit-0.1.5-magda.1.tgz`      | `9948b2a5c840c7554f4966b8161fd68c130e2071955a32571dfa18a1eda62d6e` |
| `deepseek-ai-libreoffice-kit-wasm-0.1.5-magda.1.tgz` | `6cc3e9851b3572f3ce77419743bd2a20d3e78bc55d34019a24e4d1eadad0173f` |

The WASM engine (build ID `663e3304…`) was compiled in `engine/wasm-source/container/` on
linux/arm64 and packaged from `f82a988`. Its compiled files are byte-identical to those of the
earlier candidates.

### Results

| Directory                                                  | Host                                          | Result                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`0.1.5-magda.1-linux-x64/`](0.1.5-magda.1-linux-x64/)     | GitHub `ubuntu-24.04`, `x86_64`               | Candidate vs official 0.1.5: **123/123 EQUAL** (strict). Official 0.1.5 rerun: 123/123. 0.1.3 vs 0.1.5: 122 EQUAL; only the RTL worksheet image differs |
| [`0.1.5-magda.1-linux-arm64/`](0.1.5-magda.1-linux-arm64/) | GitHub `ubuntu-24.04-arm`, `aarch64`          | Same as x64                                                                                                                                             |
| [`0.1.5-magda.1-cross-arch/`](0.1.5-magda.1-cross-arch/)   | x64 vs arm64                                  | **123/123 EQUAL** for official 0.1.5 and for the candidate (PNG pixels, text, fonts, values)                                                            |
| [`0.1.5-magda.1-smoke/`](0.1.5-magda.1-smoke/)             | Linux x64 and arm64, macOS arm64, Windows x64 | `smoke.mjs`: 8/8 checks on each. The kit selects WASM, and its TXT/CSV exports match the Linux reference byte for byte                                  |

Each comparison ran with Debian trixie, Node.js 22.23.5, and one fixture set shared by both
architectures. That set is 36 LibreOffice Core QA documents, MAGDA's Office fixtures, and generated
right-to-left, CJK, missing-font and long documents. It ran four sets: official 0.1.3, official
0.1.5 twice, and the release. The 123 cases cover:

- DSH Web's preview API (`createConverter` → `render` → `dispose`);
- the CLI's `capabilities`, `render`, `convert` and `recalculate`;
- error codes, timeout and input limits;
- cancellation followed by reuse of the converter.

A case is EQUAL only when every recorded fact matches and PNG pixels are identical. Version
strings, install paths and LibreOffice's random per-run IDs in ODT exports are ignored.

Each architecture directory holds:

- `environment.json`: harness commit, image, host, tarball and fixture hashes;
- `reports/`: `summary.md` and per-case verdicts;
- `sets/*/results.json`: every recorded fact per case;
- `outputs.sha256`: all 628 raw outputs, verified against the raw bundles.

The raw bundles are attached to the release:

| Bundle                                                 | sha256                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `comparison-evidence-0.1.5-magda.1-linux-x64.tar.gz`   | `4e5c06ded37b9727434dc1ae5355ee7bd5293081de3800d37b3ad2f6df4b651e` |
| `comparison-evidence-0.1.5-magda.1-linux-arm64.tar.gz` | `e59fe6952e57ce33af36a3414f8b22a45683594b94e0bfc08ab0746e0635eeab` |

### Earlier candidate records

Before the release, the same comparison qualified the first candidate tarballs (adapter
`7dd10e35…`, WASM `eb12e95a…`), with the same verdicts. The arm64 run was on a local
build host from `83c94dc`; the native x64 run was in run 43592800411 from `fa76ef6`. They differ from the
release in two ways: the adapter has no native optional dependencies, and the WASM package
carries no OS restriction (PR #4). Those records remain in this directory's Git history (commits
`8bdc60f` and `0173be0`).

## Re-examining or re-running

```sh
# Verify a raw bundle against its record, then re-derive the strict report from it.
mkdir bundle && tar -C bundle -xzf comparison-evidence-0.1.5-magda.1-linux-x64.tar.gz
(cd bundle && sha256sum -c ../qualification/evidence/0.1.5-magda.1-linux-x64/outputs.sha256)
docker build -t kit-qualification qualification
docker run --rm -v "$PWD":/work -w /work kit-qualification \
  python3 qualification/compare.py bundle/sets/reference bundle/sets/candidate report.json --strict

# Re-run everything from scratch (any Docker host), or dispatch the workflow with the tag.
qualification/download-release.sh v0.1.5-magda.1 candidate
qualification/run-comparison.sh candidate new-evidence
```

A re-run should reproduce every verdict. Timings and absolute paths differ between hosts.
