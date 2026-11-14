#!/usr/bin/env bash
# Reproduce the full functional comparison of a candidate against the official packages, and
# write an evidence directory. Needs only Docker on the host; everything else runs in the
# qualification image.
#
# Usage: qualification/run-comparison.sh <candidate dir> <output dir>
#   <candidate dir>  the release's adapter and WASM .tgz files and its SHA256SUMS
#   <output dir>     new directory for the evidence
#
# Sets (run concurrently, one container each, over the same fixture files):
#   baseline         official 0.1.3 npm packages (built from this branch's public source baseline)
#   reference        official 0.1.5 npm packages
#   reference-rerun  official 0.1.5 again: the run-to-run noise floor
#   candidate        the given release
# Reports: candidate vs reference (strict), reference-rerun vs reference, baseline vs reference.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
candidate=$(cd "${1:?candidate directory}" && pwd)
out=${2:?output directory}
[ ! -e "$out" ] || { echo "$out already exists" >&2; exit 1; }
mkdir -p "$out/packages-candidate" && out=$(cd "$out" && pwd)
cp "$candidate"/*.tgz "$candidate/SHA256SUMS" "$out/packages-candidate/"
cp -R "$here" "$out/qualification" && mkdir -p "$out/scripts" && cp "$repo/scripts/verify-reconstruction.mjs" "$out/scripts/"
# packages.mjs imports the pinned reference identity from verify-reconstruction.mjs and its imports.
for f in build-kit.mjs platform-matrix.mjs pack-utils.mjs publication-privacy.mjs verify-artifacts.mjs; do cp "$repo/scripts/$f" "$out/scripts/"; done
cp "$repo/package.json" "$out/package.json"

docker build -q -t kit-qualification "$here" >/dev/null
image=$(docker image inspect -f '{{.Id}}' kit-qualification)
qrun() { docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$out":/work kit-qualification "$@"; }

qrun sh -c 'set -e
  node qualification/fetch-fixtures.mjs fixtures
  node qualification/packages.mjs reference packages-reference
  node qualification/packages.mjs baseline packages-baseline
  node qualification/packages.mjs candidate packages-candidate
  for set in baseline reference candidate; do
    mkdir -p install-$set && cd install-$set && echo "{\"private\":true}" > package.json
    npm install --ignore-scripts --no-audit --no-fund --loglevel=error ../packages-$set/*.tgz
    cd ..
  done'

names=()
for run in baseline:baseline reference:reference reference:reference-rerun candidate:candidate; do
  install=${run%%:*} name=${run#*:}
  names+=("kit-cmp-$name-$$")
  docker run -d --name "kit-cmp-$name-$$" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$out":/work kit-qualification \
    sh -c "node qualification/run.mjs install-$install/node_modules/@deepseek-ai/libreoffice-kit fixtures sets/$name > logs-$name.txt 2>&1" >/dev/null
done
failed=0
for name in "${names[@]}"; do [ "$(docker wait "$name")" = 0 ] || failed=1; docker rm "$name" >/dev/null; done
[ "$failed" = 0 ] || { echo "a comparison set failed; see $out/logs-*.txt" >&2; exit 1; }

mkdir -p "$out/reports"
status=0
qrun python3 qualification/compare.py sets/reference sets/candidate reports/candidate-vs-reference.json --strict \
  --label 'candidate vs official 0.1.5' --summary reports/summary.md || status=1
qrun python3 qualification/compare.py sets/reference sets/reference-rerun reports/reference-rerun-vs-reference.json \
  --label 'official 0.1.5: second run vs first run' --summary reports/summary.md
qrun python3 qualification/compare.py sets/reference sets/baseline reports/baseline-vs-reference.json \
  --label 'official 0.1.3 vs official 0.1.5' --summary reports/summary.md

harness_commit=$(git -C "$repo" rev-parse HEAD)
harness_dirty=$([ -z "$(git -C "$repo" status --porcelain -- qualification scripts/verify-reconstruction.mjs)" ] && echo false || echo true)
qrun env IMAGE="$image" COMMIT="$harness_commit" DIRTY="$harness_dirty" python3 - <<'PY'
import hashlib, json, os, platform, subprocess, datetime
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
def tree(root):
    return {os.path.relpath(os.path.join(d, f), root): sha(os.path.join(d, f)) for d, _, fs in os.walk(root) for f in fs}
packages = {s: {f: sha(f'packages-{s}/{f}') for f in sorted(os.listdir(f'packages-{s}')) if f.endswith('.tgz')} for s in ('baseline', 'reference', 'candidate')}
installed = {s: {p: json.load(open(f'install-{s}/node_modules/@deepseek-ai/{p}/package.json'))['version'] for p in ('libreoffice-kit', 'libreoffice-kit-wasm')} for s in packages}
env = {
    'recorded': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'harness': {'repository': 'magda-io/dsh-libreoffice-kit', 'commit': os.environ['COMMIT'], 'uncommittedChanges': os.environ['DIRTY'] == 'true'},
    'host': {'machine': platform.machine(), 'kernel': platform.release(), 'node': subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip(),
             'image': os.environ['IMAGE'], 'os': open('/etc/os-release').read().split('PRETTY_NAME="')[1].split('"')[0]},
    'packages': packages, 'installed': installed,
    'fixtures': {'manifestSha256': sha('qualification/fixtures.json'), 'files': tree('fixtures')},
}
json.dump(env, open('environment.json', 'w'), indent=2)
with open('outputs.sha256', 'w') as out:
    for path, digest in sorted(tree('sets').items()):
        out.write(f'{digest}  sets/{path}\n')
PY
tar -C "$out" -czf "$out/comparison-evidence.tar.gz" environment.json outputs.sha256 reports sets fixtures logs-*.txt
echo "evidence: $out (bundle comparison-evidence.tar.gz)"
cat "$out/reports/summary.md"
exit $status
