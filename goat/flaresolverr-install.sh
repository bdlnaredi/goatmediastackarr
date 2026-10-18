#!/bin/bash
# Downloads the official FlareSolverr Linux build (it includes its own Chromium) into /config/flaresolverr/app.
# Runs as the PUID user before FlareSolverr starts; checks for a newer release at every start.
set -u
DIR=/config/flaresolverr/app
BIN="$DIR/flaresolverr/flaresolverr"
have=$(cat "$DIR/VERSION" 2>/dev/null || true)
info=$(curl -fsSL --retry 3 --max-time 30 https://api.github.com/repos/FlareSolverr/FlareSolverr/releases/latest 2>/dev/null) || info=""
if [[ -z "$info" ]]; then
  [[ -x "$BIN" ]] && { echo "[goat-flaresolverr] GitHub not reachable; starting the installed version $have."; exit 0; }
  echo "[goat-flaresolverr] Cannot reach GitHub to download FlareSolverr. It will be tried again in a minute."; exit 1
fi
want=$(jq -r .tag_name <<<"$info")
url=$(jq -r '[.assets[] | select(.name | test("linux_x64\\.tar\\.gz$"))][0].browser_download_url // empty' <<<"$info")
if [[ -x "$BIN" && "$have" == "$want" ]]; then exit 0; fi
[[ -n "$url" ]] || { echo "[goat-flaresolverr] The release $want has no Linux x64 download."; [[ -x "$BIN" ]] && exit 0 || exit 1; }
echo "[goat-flaresolverr] Downloading FlareSolverr $want${have:+ (replacing $have)}"
tmp=$(mktemp -d /config/flaresolverr/.download.XXXXXX); trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/fs.tar.gz" "$url" && mkdir -p "$tmp/new" && tar -xzf "$tmp/fs.tar.gz" -C "$tmp/new" \
  || { echo "[goat-flaresolverr] Download failed."; [[ -x "$BIN" ]] && exit 0 || exit 1; }
[[ -x "$tmp/new/flaresolverr/flaresolverr" ]] || { echo "[goat-flaresolverr] Unexpected download layout."; [[ -x "$BIN" ]] && exit 0 || exit 1; }
echo "$want" > "$tmp/new/VERSION"
rm -rf "$DIR.old"; [[ -d "$DIR" ]] && mv "$DIR" "$DIR.old"; mv "$tmp/new" "$DIR" && rm -rf "$DIR.old"
echo "[goat-flaresolverr] FlareSolverr $want installed."
