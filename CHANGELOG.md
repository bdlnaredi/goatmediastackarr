# Changelog

## Unreleased

- Smaller image: Bazarr and SABnzbd are built in a separate stage, so compilers no longer ship in the image; identical .NET runtime files shared by Sonarr, Radarr, Lidarr and Prowlarr are stored once; Seerr's source maps and docs are dropped.
- Runs on 64-bit ARM as well as x86: one image name for both, each built on its own native machine.
- Weekly rebuild with the newest engines, published as `latest` only when every check passes.
- Optional FlareSolverr, downloaded on first start, added to Prowlarr as a tagged proxy and kept on the VPN with Prowlarr.
- Shows and movies have their own address (`/library/tv/<app>/<id>`); opening one updates the address and Back closes it.
## Fixes

- OpenVPN: files a .ovpn names without a folder (`credentials.conf`, `ca.crt`, keys) are found next to it in the vpn folder; a file that needs a username and password with none given now says so on the Stack page instead of failing.
- Bazarr no longer gets stuck on "port already in use" (code -105) after a restart: its worker is run directly, so stopping it really stops it.

## 0.1.0 (unreleased)

First stage: the container foundation.

- One image with Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, qBittorrent, SABnzbd, Jellyfin, Seerr and Tautulli, each kept running by s6 and restarted on its own if it stops.
- First start creates every key and password and writes each engine's settings, so they listen only inside the container.
- Automatic connections: library folders and download clients in Sonarr, Radarr and Lidarr; Prowlarr syncing to all three; Bazarr with Sonarr and Radarr; Jellyfin set up with its libraries; Seerr signed in through Jellyfin and connected to Sonarr and Radarr. Running again skips what already exists.
- Built-in VPN (WireGuard or OpenVPN) for qBittorrent, SABnzbd and Prowlarr only, with a kill switch, DNS through the tunnel, automatic reconnect and NAT-PMP port forwarding.
- Interface from MediaHub 0.14.19: the built-in apps are added and kept up to date automatically, `/api/goat/status` reports the VPN and connections, and admins can open each engine's own page at `/engines/<name>/`.
- Web page on port 2806.
- Library and downloads are separate folders (`/media`, `/downloads`) by default; `MEDIA_DIR` and `DOWNLOADS_DIR` let both live inside one shared folder instead.
- Optional built-in Plex: downloaded from plex.tv on first start, linked with a claim code, libraries created, and Tautulli and (optionally) Seerr connected to it. An existing Plex server can be added instead.
- Jellyfin's first-run setup survives its start-up restart, and failed connections are retried right away.
- New goat logo and app icons; the interface is named GoatMediaStackarr.
- README screenshots, refreshed by the "Update screenshots" workflow.
- Every tab and Settings section has its own address (/downloads, /settings/apps); dialogs open as layers that the back button closes.
- Stack page: setup checklist, VPN controls with file upload and leak test, app health and restarts, generated logins, Plex linking, connection results.
- Usenet page: add, change, test and remove your provider's news servers in SABnzbd.
- Bring in your current setup: copy shows, movies, artists and Prowlarr indexers from existing apps, with folder translation and nothing added twice.
- Unraid template and docker-compose example.
