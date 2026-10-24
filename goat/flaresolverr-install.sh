#!/bin/bash
# Downloads the official FlareSolverr Linux build (it includes its own Chromium) into /config/flaresolverr/app.
# Runs as the PUID user before FlareSolverr starts; checks for a newer release at every start.
set -u
DIR=/config/flaresolverr/app
BIN="$DIR/flaresolverr/flaresolverr"
# The release carries its own Chromium here. Without it FlareSolverr says "Chrome / Chromium web browser not installed".
CHROME="flaresolverr/_internal/chrome/chrome"
have=$(cat "$DIR/VERSION" 2>/dev/null || true)
# A copy that is missing its browser (an unpacking that stopped part way, say on a full disk) is downloaded again.
if [[ -x "$BIN" && ! -x "$DIR/$CHROME" ]]; then
  echo "[goat-flaresolverr] The installed FlareSolverr is missing its Chromium browser; downloading it again."
  have=""; rm -f "$DIR/VERSION"
fi
ok_install() { [[ -x "$BIN" && -x "$DIR/$CHROME" ]]; }
info=$(curl -fsSL --retry 3 --max-time 30 https://api.github.com/repos/FlareSolverr/FlareSolverr/releases/latest 2>/dev/null) || info=""
if [[ -z "$info" ]]; then
  ok_install && { echo "[goat-flaresolverr] GitHub not reachable; starting the installed version $have."; exit 0; }
  echo "[goat-flaresolverr] Cannot reach GitHub to download FlareSolverr. It will be tried again in a minute."; exit 1
fi
want=$(jq -r .tag_name <<<"$info")
url=$(jq -r '[.assets[] | select(.name | test("linux_x64\\.tar\\.gz$"))][0].browser_download_url // empty' <<<"$info")
if ok_install && [[ "$have" == "$want" ]]; then exit 0; fi
[[ -n "$url" ]] || { echo "[goat-flaresolverr] The release $want has no Linux x64 download."; ok_install && exit 0 || exit 1; }
# The download is about 260 MB and unpacks to about 900 MB; check there is room first, so it never half unpacks.
free_mb=$(df -Pm /config/flaresolverr | awk 'NR==2 {print $4}')
if [[ -n "$free_mb" && "$free_mb" -lt 1500 ]]; then
  echo "[goat-flaresolverr] Not enough free space in App data to download FlareSolverr: it needs about 1.5 GB, there is ${free_mb} MB."
  ok_install && exit 0 || exit 1
fi
echo "[goat-flaresolverr] Downloading FlareSolverr $want${have:+ (replacing $have)}"
tmp=$(mktemp -d /config/flaresolverr/.download.XXXXXX); trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/fs.tar.gz" "$url" && mkdir -p "$tmp/new" && tar -xzf "$tmp/fs.tar.gz" -C "$tmp/new" \
  || { echo "[goat-flaresolverr] Download failed."; ok_install && exit 0 || exit 1; }
[[ -x "$tmp/new/flaresolverr/flaresolverr" && -x "$tmp/new/$CHROME" ]] || { echo "[goat-flaresolverr] The download is incomplete or laid out differently (no FlareSolverr or no Chromium in it)."; ok_install && exit 0 || exit 1; }
echo "$want" > "$tmp/new/VERSION"
rm -rf "$DIR.old"; [[ -d "$DIR" ]] && mv "$DIR" "$DIR.old"; mv "$tmp/new" "$DIR" && rm -rf "$DIR.old"
echo "[goat-flaresolverr] FlareSolverr $want installed."
