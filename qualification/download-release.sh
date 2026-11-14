#!/usr/bin/env bash
# Download a release's adapter and WASM tarballs and its SHA256SUMS, then verify them.
# Draft releases are found by their intended tag; seeing them needs a gh login (or GH_TOKEN)
# with write access to the repository.
#
# Usage: qualification/download-release.sh <tag> <output dir> [owner/repo]
set -euo pipefail
tag=${1:?release tag}
out=${2:?output directory}
repo=${3:-${GITHUB_REPOSITORY:-magda-io/dsh-libreoffice-kit}}
here=$(cd "$(dirname "$0")" && pwd)

ids=$(gh api "repos/$repo/releases" --paginate --jq ".[] | select(.tag_name == \"$tag\") | .id")
[ "$(printf '%s\n' "$ids" | grep -c .)" = 1 ] || { echo "expected exactly one release tagged $tag in $repo" >&2; exit 1; }
mkdir -p "$out"
gh api "repos/$repo/releases/$ids/assets" --paginate \
  --jq '.[] | select((.name | endswith(".tgz")) or .name == "SHA256SUMS") | "\(.id) \(.name)"' |
  while read -r id name; do
    gh api -H 'Accept: application/octet-stream' "repos/$repo/releases/assets/$id" > "$out/$name"
  done
node "$here/packages.mjs" candidate "$out"
