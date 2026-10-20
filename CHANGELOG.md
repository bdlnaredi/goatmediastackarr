# Changelog

## Unreleased

- App updates are visible: the Stack page (web page and app) shows each app's version, and after an update lists what changed ("Sonarr 4.0.15 → 4.0.16"). Admins see it in the bell, and alert channels can be told (Alerts: "Apps inside the container are updated").
- The weekly rebuild now really updates Seerr, Bazarr and SABnzbd too. Seerr was fixed at 3.5.0, and Bazarr and SABnzbd could be reused from an earlier build.
- RSS in the app: tick several articles (Select, or press and hold one), then download them all at once into a category, or mark them read. Select all, too.
- Private Internet Access (PIA) built in: choose PIA on the Stack page, enter your PIA username and password and pick a region (or the fastest), and the VPN connects over WireGuard with no file to download. PIA's port forwarding is supported too: the port is renewed every 15 minutes and given to qBittorrent.
- Alerts: every channel (ntfy, Discord, Telegram, email…) has its own list of what it is told about — finished and grabbed downloads, new requests, a request ready to watch, problem reports, an app offline, the VPN, a full array, streaming limits, new versions and the weekly newsletter — and an optional name. Channels you already had keep sending what they sent before.
- Interactive search in the app: "Choose a release" on a movie, on each episode of a show and on every Wanted item lists what your indexers have (quality, size, seeders, language, why Sonarr or Radarr would skip it), and Download sends the one you pick.
- Upcoming in the app has a Calendar view: a month grid with a dot for each episode or movie, earlier and later months, and the list for the day you tap.
- Stack (web page and app): each app has a Stop button, and a stopped app a Start button; it stays stopped until you start it or the container restarts.
- Settings on the web page: the sections are tabs across the top instead of a list down the side, and a new Limits section shows everyone's streaming and space this month (and earlier months) with their limits, changeable in place.
- Trackers (web page and app, admins): search all your Prowlarr trackers at once and send a result to qBittorrent; and browse tracker websites (IPTorrents, TorrentLeech, TorrentDay…) inside GoatMediaStackarr, each through the VPN or not (your choice when adding it), signed in once, with every download or magnet button going straight to qBittorrent. A small helper inside the container fetches the VPN sites, so they use the tunnel and stop when it is down.
- Android app notifications: real phone notifications, also when the app is closed (it looks every 15, 30 or 60 minutes, and every 30 seconds while open; no Google services needed). For everyone: ready to watch, request approved or declined, a download that failed, streaming limits, new versions. For admins also: new requests, problem reports, server problems (an app stops answering, the VPN drops, the array is nearly full) and, if wanted, every finished download. Each kind can be switched off in Settings → Notifications, with a test button; tapping one opens its page. Home has a bell with the number of new ones, and a list of all of them.
- Unraid: the image carries Unraid's icon label, so the Docker tab can pick up the current icon.
- Update notices: when a newer release is out, the phone app says so on Home (with a button to get the new app) and in Settings; admins are also told, in the app and on the web page, to update the container (Unraid's Docker tab, Update). Checked against GitHub's latest release at most every 6 hours; "Later" or "Got it" hides it until the next version.
- Streaming limits: each person may stream 100 GB a month from Plex and Jellyfin by default; at 80% they get a phone message, and at the limit their streams are stopped with a message until the 1st. The default, "only count streams from outside the home", and a limit per person (or none) are set in the app and on the web page (Settings → Limits). The app's Profile shows this month's streaming and the last six months; the Users page shows everyone's.
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

- Prowlarr keeps sending indexers to Sonarr, Radarr and Lidarr after their API keys change (for example after restoring one of them from a backup): every start updates the key Prowlarr has for them.
- Seerr keeps working with Sonarr and Radarr after their API keys change: every start checks the address and key Seerr uses for the built-in Sonarr and Radarr and updates them (or adds them back if they were removed). A stale key showed as "Unable to get queue from Radarr/Sonarr server" in Seerr's download tracker, and requests could fail.
- WireGuard (PIA and provider files): traffic now really flows. WireGuard's encrypted packets kept the VPN apps' mark, so they were sent back into the tunnel in a loop — the handshake worked but nothing came back, and huge amounts showed as sent. WireGuard now marks its own packets separately. A new test runs a real WireGuard tunnel with the kill switch on every change.
- OpenVPN no longer fails with "Cannot ioctl TUNSETIFF goatvpn: Device or resource busy" after the VPN is reconnected or its settings are saved: the VPN service now takes its tunnel down when it is stopped or restarted, stops a connection attempt that timed out, and clears any tunnel left over from before it starts a new one.
- Seerr's own page (port 5055) no longer shows "Seerr Updated, please reload" every time it opens: its version number is now built into the page as well as the server, so the two agree.
- Tracker websites load much faster, especially through the VPN: pages pass through as they arrive instead of being fetched whole twice first; pictures, styles, scripts and fonts are kept for six hours (on the server and on the phone), so later pages skip them; text is compressed on the way to the phone; sign-in cookies are saved a few seconds later in one go instead of on every picture; and reopening a site keeps its address, so the phone's own cache keeps working.
- Admins can sign in with Plex: link your Plex account first in Settings → Account (web page or app); until then Plex sign-in still refuses admin accounts, so nobody can take one over through Plex.
- Tracker websites opened on a phone use the phone's width instead of a zoomed-out desktop page, when the site does not say how to show itself on phones.
- From outside the home: phone apps for Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, SABnzbd and Tautulli (nzb360, LunaSea…) work through GoatMediaStackarr's address at `/engines/<app>` with that app's own API key; the Stack page takes the outside addresses of Jellyfin, Seerr and Plex (a Cloudflare hostname), and its Open buttons use them away from home.
- Requests show where they really are, read from Radarr or Sonarr and from Plex or Jellyfin instead of waiting on Seerr: Requested (waiting for an admin), Approved, looking for a download, Downloading (with how far along and time left), Copying to the library, In the library (waiting for Plex), and Available (on Plex or Jellyfin). Plex and Jellyfin are asked to look for the new files, and the person is told when it is ready. Before, a finished download could stay on "Downloading".
- Movie and show pages (web page and app) have the title's picture faded in behind them.
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
