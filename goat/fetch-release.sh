#!/bin/sh
# fetch-release OWNER/REPO TAG ASSET_REGEX OUTPUT
# Downloads the one release asset whose file name matches ASSET_REGEX.
# Looking the name up through the GitHub API keeps the build working when projects rename their files.
set -eu
repo="$1"; tag="$2"; pattern="$3"; out="$4"
auth=""
[ -n "${GITHUB_TOKEN:-}" ] && auth="Authorization: Bearer ${GITHUB_TOKEN}"
json=$(curl -fsSL --retry 4 --retry-delay 5 ${auth:+-H "$auth"} "https://api.github.com/repos/${repo}/releases/tags/${tag}")
url=$(printf '%s' "$json" | jq -r --arg re "$pattern" '[.assets[] | select(.name | test($re)) | select(.name | test("musl|arm|aarch64") | not)] | .[0].browser_download_url // empty')
if [ -z "$url" ]; then
  echo "fetch-release: no asset in ${repo} ${tag} matches ${pattern}. Available:" >&2
  printf '%s' "$json" | jq -r '.assets[].name' >&2
  exit 1
fi
echo "fetch-release: ${url}"
curl -fsSL --retry 4 --retry-delay 5 -o "$out" "$url"
