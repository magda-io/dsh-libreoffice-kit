# Functional comparison evidence: 0.1.5-magda.1 on Linux x64

This is the recorded output of `qualification/run-comparison.sh`, run by the **MAGDA qualification**
workflow ([run 43592800411](https://github.com/magda-io/dsh-libreoffice-kit/actions/runs/43592800411))
on 2026-11-14. It ran on GitHub's native `ubuntu-24.04` x64 runner (`x86_64`, Azure kernel,
Debian trixie image, Node.js 22.23.5), from harness commit
`fa76ef6155e50305bcacf8aa87eabefda9844966` (the `magda` merge of the reconstruction) with no
local changes. `environment.json` holds the full details.

The candidate is release `v0.1.5-magda.1`: adapter `7dd10e35…`, WASM `eb12e95a…`, the same
tarballs as the [arm64 evidence](../0.1.5-magda.1-linux-arm64/).

| Comparison                              | Result                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| candidate vs official 0.1.5 (strict)    | **123 of 123 cases EQUAL**                                                      |
| official 0.1.5: second run vs first run | 123 of 123 EQUAL                                                                |
| official 0.1.3 vs official 0.1.5        | 122 EQUAL; `render:edge-rtl.xlsx` differs in pixels (0.1.5's right-to-left fix) |

**Cross-architecture** (`cross-arch/`): the same run also qualified the release on
`ubuntu-24.04-arm`, from one shared fixture set. Comparing the two runners:

- official 0.1.5, x64 vs arm64: **123/123 EQUAL**;
- candidate, x64 vs arm64: **123/123 EQUAL**.

PNG pixels, PDF text, fonts and recalculated values are all identical across the two
architectures.

The files and the re-examination steps are as described in the
[arm64 evidence README](../0.1.5-magda.1-linux-arm64/README.md). The raw bundle is
`comparison-evidence-0.1.5-magda.1-linux-x64.tar.gz` (sha256
`b809dcf127e42eb54cacabbdc38ae11611adeff8eebcd41fd638de02d6a6a2ae`), attached to the
`v0.1.5-magda.1` release. The workflow's own artifacts expire after 90 days.
