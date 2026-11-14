#!/usr/bin/env bash
# Build and stage the Node WASM engine from one commit of this repository.
#
# Usage: build-libreoffice-kit-wasm <repository> <commit> [jobs]
#   <repository>  Git URL or mounted path of this repository.
#   <commit>      Full commit to build; the checkout is verified against it.
#   [jobs]        Core build parallelism (default: the container's CPU count).
#
# State lives below /build/libreoffice-kit (mount a volume there): workspace,
# source, emsdk, build, tarballs and dist use the paths recorded in the
# published engine receipts. Rerunning resumes a compatible build; a changed
# recipe is rejected by build.mjs and needs a fresh volume.
set -euo pipefail

repository=${1:?repository}
commit=${2:?commit}
jobs=${3:-$(nproc)}
base=/build/libreoffice-kit
workspace=$base/workspace

[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "commit must be a full SHA" >&2; exit 2; }

if [ ! -d "$workspace/.git" ]; then
  git clone --no-checkout "$repository" "$workspace"
fi
git -C "$workspace" fetch --quiet "$repository" "$commit" 2>/dev/null || true
git -C "$workspace" checkout --quiet --detach "$commit"
[ "$(git -C "$workspace" rev-parse HEAD)" = "$commit" ] || { echo "checkout is not $commit" >&2; exit 1; }
[ -z "$(git -C "$workspace" status --porcelain --untracked-files=no)" ] || { echo "workspace has local changes" >&2; exit 1; }

cd "$workspace"
# scripts/checkout-wasm.mjs, with the receipt paths instead of .build/wasm.
node --input-type=module -e "
  import { checkoutCore } from './scripts/core-checkout.mjs';
  checkoutCore('$base/source');
"
node --input-type=module -e "
  import { readWasmSource } from './engine/wasm-source/source.mjs';
  const { emsdk } = readWasmSource();
  console.log([emsdk.repository, emsdk.commit, emsdk.version].join(' '));
" | {
  read -r url revision version
  if [ ! -d "$base/emsdk/.git" ]; then
    git init --quiet "$base/emsdk"
    git -C "$base/emsdk" remote add origin "$url"
    git -C "$base/emsdk" fetch --quiet --depth=1 origin "$revision"
    git -C "$base/emsdk" checkout --quiet --detach FETCH_HEAD
  fi
  [ "$(git -C "$base/emsdk" rev-parse HEAD)" = "$revision" ] || { echo "emsdk is not $revision" >&2; exit 1; }
  python3 "$base/emsdk/emsdk.py" install "$version"
  python3 "$base/emsdk/emsdk.py" activate "$version"
}

paths=(--source "$base/source" --emsdk "$base/emsdk" --build "$base/build")
node engine/wasm-source/build.mjs --stage build "${paths[@]}" \
  --tarballs "$base/tarballs" --output "$base/dist" --jobs "$jobs"
node engine/wasm-source/stage.mjs "${paths[@]}" --bundle "$base/dist"
git status --short -- packages/wasm
