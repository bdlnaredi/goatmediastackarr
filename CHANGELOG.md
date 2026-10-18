# Changelog

## Unreleased

- Streaming limits: each person may stream 100 GB a month from Plex and Jellyfin by default; at 80% they get a phone message, and at the limit their streams are stopped with a message until the 1st. The default, "only count streams from outside the home", and a limit per person (or none) are set in the app and on the web page (Settings → Users). The app's Profile shows this month's streaming and the last six months; the Users page shows everyone's.
- Android app, version 3: movies and shows open their own page (story, cast, seasons, trailer, in the library or not) instead of a pop-up; each episode shows its story and can be searched for; an RSS page (articles, feeds, auto-download rules); Downloads adds magnet links, filters and moves by category, and admins manage categories and tags; a Profile page with your picture, the space your requests take and your watch time; a fuller Settings page (start page, poster size, update speed, hide episode stories, password, recovery email, phone messages, signed-in devices).
- Profile pictures: upload one from the app (it is made small on the phone first); it shows next to your name.
- Space limits: an admin can give each person a limit in GB (in the app on their profile, or on the web page under Settings → Users). It counts the disk space of what they requested; at the limit, new requests are refused with a message saying so.
- Android app, version 2: Wanted, Music (Lidarr, with adding artists), Subtitles (find missing ones through Bazarr), Stats (Tautulli), Health, Indexers (test and remove), Usenet servers (add, test, change, remove), Unraid (array, disks, start and stop containers), Users (add and delete profiles) and Bring in your setup, all from More.
- Android app: a native app (Kotlin and Jetpack Compose) with its own design and eight themes, Home, Discover, Search, Library with show and movie pages, Downloads, Requests, Upcoming, Stack and Settings; sign in with a password (and two-step code) or with Plex. Each release has `goatmediastackarr.apk` attached.
- Smaller image: Bazarr and SABnzbd are built in a separate stage, so compilers no longer ship in the image; identical .NET runtime files shared by Sonarr, Radarr, Lidarr and Prowlarr are stored once; Seerr's source maps and docs are dropped.
- Runs on 64-bit ARM as well as x86: one image name for both, each built on its own native machine. Bazarr uses Jellyfin's ffmpeg and ffprobe, since its own download only has them for x86.
- Weekly rebuild with the newest engines, published as `latest` only when every check passes.
- Optional FlareSolverr, downloaded on first start, added to Prowlarr as a tagged proxy and kept on the VPN with Prowlarr.
- Shows and movies have their own address (`/library/tv/<app>/<id>`); opening one updates the address and Back closes it.

## Fixes

- Health page: disk space is shown once (not under every app), each folder says what it is (Media library, Downloads, App data, the container's Docker image), big disks are shown in TB with how full they are, and an app's name is no longer repeated next to it.
- Web page: movies and shows (from the Library, Discover, Search, Wanted and Upcoming) open as their own full page with a Back button, instead of a pop-up; each episode shows its story (tap it to read all of it) and its length.
- Adding a download category says what went wrong (a name already taken, or one starting or ending with a slash) instead of failing silently.
- qBittorrent's torrent port is 50413 instead of 6881, which many trackers block (qBittorrent showed "port is blacklisted"). Installs still on 6881 are moved; a port picked by hand is kept; `TORRENT_PORT` sets another.
- OpenVPN: files a .ovpn names without a folder (`credentials.conf`, `ca.crt`, keys) are found next to it in the vpn folder; a file that needs a username and password with none given now says so on the Stack page instead of failing.
- Bazarr no longer gets stuck on "port already in use" (code -105) after a restart: its worker is run directly, so stopping it really stops it.
- Stack page: "Apps connected to each other" gets its tick once the connections succeed, even while Plex is still waiting to be linked (that has its own item), and the page updates itself while the apps are being connected.
- Seerr works with a Plex server outside the container: when no Jellyfin or Plex runs inside, it signs in through the Plex server added under Settings, then Apps.
- Importing from Sonarr, Radarr or Lidarr can bring in your settings first (ticked by default): quality profiles, custom formats, delay and release profiles, and file naming, so every show, movie and artist keeps its own profile and new downloads are named like your files.
- Importing keeps tags, on shows, movies, artists and Prowlarr indexers (a FlareSolverr tag, say), matched by name.
- Tautulli works with a Plex server outside the container too, unless you already pointed it at another server yourself.
- The setup checklist ticks Indexers once Prowlarr has at least one, and Usenet once SABnzbd has a news server.
- The version shown in the interface is the installed release, not 0.1.0.
- Seerr's own request page is on port 5055 (add the port to the container), and the Stack page has an Open button for it.

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
