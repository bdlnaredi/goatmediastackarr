#!/bin/sh
# fetch-release OWNER/REPO TAG|latest ASSET_REGEX OUTPUT [VERSION_FILE]
# VERSION_FILE, if given, gets the release's tag, so the image can list which version of each app it carries.
# Downloads the one release asset whose file name matches ASSET_REGEX (musl builds are skipped: the image uses glibc).
# The pattern names the architecture (x64 / arm64), so one script serves both.
# Looking the name up through the GitHub API keeps the build working when projects rename their files.
set -eu
repo="$1"; tag="$2"; pattern="$3"; out="$4"
auth=""
[ -n "${GITHUB_TOKEN:-}" ] && auth="Authorization: Bearer ${GITHUB_TOKEN}"
api() { curl -fsSL --retry 4 --retry-delay 5 ${auth:+-H "$auth"} "https://api.github.com/repos/${repo}/releases/$1"; }
# TAG "latest" means the newest stable release. A pinned tag that has no release falls back to latest.
if [ "$tag" = latest ]; then
  json=$(api latest)
elif ! json=$(api "tags/${tag}" 2>/dev/null); then
  echo "fetch-release: ${repo} has no release ${tag}, using the latest stable release instead" >&2
  json=$(api latest)
fi
got=$(printf '%s' "$json" | jq -r .tag_name)
echo "fetch-release: ${repo} ${got}"
if [ -n "${5:-}" ]; then mkdir -p "$(dirname "$5")"; printf '%s\n' "$got" > "$5"; fi
url=$(printf '%s' "$json" | jq -r --arg re "$pattern" '[.assets[] | select(.name | test($re)) | select(.name | test("musl") | not)] | .[0].browser_download_url // empty')
if [ -z "$url" ]; then
  echo "fetch-release: no asset in ${repo} ${tag} matches ${pattern}. Available:" >&2
  printf '%s' "$json" | jq -r '.assets[].name' >&2
  exit 1
fi
echo "fetch-release: ${url}"
curl -fsSL --retry 4 --retry-delay 5 -o "$out" "$url"
