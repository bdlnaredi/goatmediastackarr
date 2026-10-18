#!/bin/bash
# Downloads the official Plex Media Server from plex.tv into /config/plex/pms. Runs as the PUID user before
# Plex starts. Plex is free to use but not open source, so it is fetched from Plex itself rather than shipped
# in the GoatMediaStackarr image (the same way the official Plex Docker image gets its updates).
#   PLEX_UPDATE=true (default)  check for a newer public release at every start
#   PLEX_UPDATE=false           keep the installed version
set -u
DIR=/config/plex/pms
BIN="$DIR/usr/lib/plexmediaserver/Plex Media Server"
have=$(cat "$DIR/VERSION" 2>/dev/null || true)

if [[ -x "$BIN" && "${PLEX_UPDATE,,}" == "false" ]]; then exit 0; fi

info=$(curl -fsSL --retry 3 --max-time 30 https://plex.tv/api/downloads/5.json 2>/dev/null) || info=""
if [[ -z "$info" ]]; then
  [[ -x "$BIN" ]] && { echo "[goat-plex] plex.tv not reachable; starting the installed Plex $have."; exit 0; }
  echo "[goat-plex] Cannot reach plex.tv to download Plex Media Server. It will be tried again in a minute."
  exit 1
fi
want=$(jq -r '.computer.Linux.version' <<<"$info")
build=linux-x86_64; [[ "$(uname -m)" == aarch64 ]] && build=linux-aarch64
url=$(jq -r --arg b "$build" '[.computer.Linux.releases[] | select(.build == $b and .distro == "debian")][0].url // empty' <<<"$info")
if [[ -x "$BIN" && "$have" == "$want" ]]; then exit 0; fi
if [[ -z "$url" ]]; then
  echo "[goat-plex] plex.tv did not list a $build download."
  [[ -x "$BIN" ]] && exit 0 || exit 1
fi

echo "[goat-plex] Downloading Plex Media Server $want${have:+ (replacing $have)}"
tmp=$(mktemp -d /config/plex/.download.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/pms.deb" "$url" || { echo "[goat-plex] Download failed."; [[ -x "$BIN" ]] && exit 0 || exit 1; }
mkdir -p "$tmp/new" && dpkg-deb -x "$tmp/pms.deb" "$tmp/new" || { echo "[goat-plex] The download could not be unpacked."; [[ -x "$BIN" ]] && exit 0 || exit 1; }
echo "$want" > "$tmp/new/VERSION"
rm -rf "$DIR.old"; [[ -d "$DIR" ]] && mv "$DIR" "$DIR.old"
mv "$tmp/new" "$DIR" && rm -rf "$DIR.old"
echo "[goat-plex] Plex Media Server $want installed."
