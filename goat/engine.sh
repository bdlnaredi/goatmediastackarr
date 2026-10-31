#!/command/with-contenv bash
# Starts one engine as the PUID/PGID user. Apps listed in VPN_APPS also get the VPN group,
# which is what sends their traffic through the tunnel (see vpn-init.sh).
# Settings changed in the interface (settings.json) take priority over the container template.
eval "$(node "$(dirname "$0")/settings.js" env 2>/dev/null)"
set -u
name="$1"
PUID="${PUID:-99}"; PGID="${PGID:-100}"; GID="${GOAT_VPN_GID:-9000}"
in_list() { [[ ",${2// /}," == *",$1,"* ]]; }

# ruTorrent and Deluge each have a second service for their web page; it is on when the app is.
app="${name%-web}"
# File Browser is always there (it is small), unless GOAT_FILEBROWSER=false.
if [[ "$name" == filebrowser && "${GOAT_FILEBROWSER:-true}" == false ]]; then echo "[goat] File Browser is turned off (GOAT_FILEBROWSER)."; exec sleep infinity; fi
if [[ "$name" != ui && "$name" != wire && "$name" != sitefetch && "$name" != filebrowser ]] && ! in_list "$app" "${GOAT_ENGINES,,}"; then
  echo "[goat] $name is turned off (GOAT_ENGINES)."
  exec sleep infinity
fi

groups="$PGID"
vpn_list="${VPN_APPS,,}"
# FlareSolverr visits indexer sites on Prowlarr's behalf, so it uses the VPN whenever Prowlarr does.
in_list prowlarr "$vpn_list" && vpn_list="$vpn_list,flaresolverr"
# ruTorrent's rTorrent and Deluge's daemon download torrents, so they follow qBittorrent onto the VPN. Their web pages
# (rutorrent-web, deluge-web) never use the VPN: they must answer on your network.
in_list qbittorrent "$vpn_list" && vpn_list="$vpn_list,rutorrent,deluge"
# The site browser's helper always uses the VPN when the VPN is on (sites added "without the VPN" do not use it at all).
vpn_list="$vpn_list,sitefetch"
if [[ "${VPN_ENABLED,,}" == "true" ]] && in_list "$name" "$vpn_list"; then
  if [[ ! -f /run/goat/killswitch-ok ]]; then
    echo "[goat] Not starting $name: the VPN kill switch is not active, and $name must only use the VPN."
    sleep 60; exit 1
  fi
  groups="$PGID,$GID"
fi

export HOME="/config/$app"
umask "${UMASK:-002}"
case "$name" in
  sonarr|radarr|lidarr|prowlarr)
    bin="/opt/$name/${name^}"; cmd=("$bin" -nobrowser "-data=/config/$name") ;;
  bazarr)
    cd /opt/bazarr || exit 1
    # Run Bazarr's worker directly. Its bazarr.py launcher does not pass a stop on to the worker, which then keeps
    # port 6767 and makes every later start fail ("port already in use", code -105). Bazarr's own restart and
    # shutdown write these files and exit; s6 then starts it again.
    export STOPFILE=/config/bazarr/bazarr.stop RESTARTFILE=/config/bazarr/bazarr.restart
    rm -f "$STOPFILE" "$RESTARTFILE"
    # A worker left behind by an older version of this container still holds the port; stop it first.
    pkill -f 'bazarr/main\.py --no-update' 2>/dev/null && sleep 2
    cmd=(/opt/bazarr/venv/bin/python -u /opt/bazarr/bazarr/main.py --no-update --config /config/bazarr) ;;
  qbittorrent)
    cmd=(/usr/local/bin/qbittorrent-nox --profile=/config/qbittorrent --webui-port=8080) ;;
  rutorrent)
    # rTorrent, the downloader behind ruTorrent. -D keeps the older command names ruTorrent still uses.
    export TERM=xterm
    # A lock left behind when the container stopped would keep it from starting.
    rm -f /config/rutorrent/session/rtorrent.lock
    cmd=(/opt/rtorrent/bin/rtorrent -n -D -o import=/config/rutorrent/rtorrent.rc) ;;
  rutorrent-web)
    # ruTorrent's page on port 8090, served by PHP's own web server behind a small gatekeeper that asks for the login
    # made for you (rutorrent-router.php). It reads its settings from these RU_ variables.
    sec=/config/goat/secrets.json
    export RU_USER="$(jq -r '.rutorrentUser // "goat"' "$sec")" RU_PASS="$(jq -r '.rutorrentPass // ""' "$sec")"
    export RU_SCGI_HOST=127.0.0.1 RU_SCGI_PORT=5000 RU_TOP_DIR=/ RU_PROFILE_PATH=/config/rutorrent/share
    export RU_TEMP_DIRECTORY=/config/rutorrent/tmp RU_LOG_FILE=/config/rutorrent/errors.log PHP_CLI_SERVER_WORKERS=8
    # Start once rTorrent answers, so the first page does not time out waiting for it (up to a minute).
    for _ in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/5000) 2>/dev/null && break; sleep 1; done
    # PHP's web server answers with several worker processes. A worker left over from before a restart (after the
    # login was changed, say) would keep the port and keep asking for the old password, so stop any first.
    pkill -f -- '-S 0\.0\.0\.0:8090' 2>/dev/null && sleep 1
    # Open ruTorrent once in the background, so its plugins (RSS, scheduler, ratio rules) run without anyone opening it.
    ( sleep 15; curl -fsS -o /dev/null -u "$RU_USER:$RU_PASS" http://127.0.0.1:8090/php/getplugins.php || true ) &
    cmd=(/usr/bin/php -d variables_order=EGPCS -d memory_limit=256M -d upload_max_filesize=32M -d post_max_size=40M -d max_execution_time=300
         -S 0.0.0.0:8090 -t /opt/rutorrent /opt/goat/bin/rutorrent-router.php) ;;
  deluge)
    # Deluge's daemon. Only reachable inside the container; its Web UI (deluge-web) is the way in.
    cmd=(/opt/deluge/bin/deluged -d -c /config/deluge -L info) ;;
  deluge-web)
    cmd=(/opt/deluge/bin/deluge-web -d -c /config/deluge -p 8112 -i 0.0.0.0 -L info) ;;
  sabnzbd)
    cmd=(/opt/sabnzbd/venv/bin/python /opt/sabnzbd/SABnzbd.py --config-file /config/sabnzbd/sabnzbd.ini --browser 0) ;;
  jellyfin)
    cmd=(/usr/bin/jellyfin --datadir /config/jellyfin/data --configdir /config/jellyfin/config
         --cachedir /config/jellyfin/cache --logdir /config/jellyfin/log --webdir /usr/share/jellyfin/web)
    # Jellyfin will not start without a working ffmpeg, so point it at whichever one is installed.
    for ff in /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/bin/ffmpeg; do [[ -x "$ff" ]] && { cmd+=(--ffmpeg "$ff"); break; }; done
    export TMPDIR=/config/jellyfin/tmp; mkdir -p "$TMPDIR" && chown "$PUID:$PGID" "$TMPDIR" ;;
  seerr)
    # Seerr cannot run under a sub-address, so it has its own port (5055) for its request page. It has its own sign-in.
    cd /opt/seerr || exit 1
    export NODE_ENV=production CONFIG_DIRECTORY=/config/seerr HOST=0.0.0.0 PORT=5055
    cmd=(/usr/local/bin/node dist/index.js) ;;
  tautulli)
    if in_list plex "${GOAT_ENGINES,,}"; then
      # When Plex is being linked (PLEX_CLAIM), give it up to 10 minutes to download and link first,
      # so Tautulli starts already connected to it.
      prefs="/config/plex/Library/Application Support/Plex Media Server/Preferences.xml"
      [[ -n "${PLEX_CLAIM:-}" ]] && for _ in $(seq 1 120); do grep -q 'PlexOnlineToken="[^"]' "$prefs" 2>/dev/null && break; sleep 5; done
    fi
    # Points Tautulli at the built-in Plex, or at your own Plex server when that is set.
    /usr/local/bin/node /opt/goat/bin/init.js tautulli
    cmd=(/usr/bin/python3 /opt/tautulli/Tautulli.py --datadir /config/tautulli --config /config/tautulli/config.ini --nolaunch) ;;
  flaresolverr)
    if [[ "$(uname -m)" != x86_64 ]]; then
      echo "[goat] FlareSolverr only offers a ready-made build for x86 servers, so it is not available on $(uname -m)."
      exec sleep infinity
    fi
    # Its bundled Chromium needs some system libraries. They are added the first time it runs in this container,
    # instead of making the image bigger for everyone.
    fs_libs() {
      echo "[goat] Adding the libraries FlareSolverr's browser needs (first start only)..."
      if apt-get update -qq && apt-get install -y -qq --no-install-recommends libnss3 libnspr4 libatk-bridge2.0-0t64 libatk1.0-0t64 \
           libatspi2.0-0t64 libgbm1 libdrm2 libwayland-server0 libwayland-client0 libxkbcommon0 libasound2t64 libcups2t64 libdbus-1-3 libxcomposite1 libxdamage1 libxrandr2 \
           libxfixes3 libxi6 libxext6 libxrender1 libxss1 libpango-1.0-0 libcairo2 libgtk-3-0t64 libglib2.0-0t64 fontconfig \
           fonts-liberation xvfb xauth >/dev/null; then
        mkdir -p /var/lib/goat && touch /var/lib/goat/flaresolverr-libs; rm -rf /var/lib/apt/lists/*
      else echo "[goat] Could not add them (no internet?). Trying again in a minute."; sleep 60; exit 1; fi
    }
    [[ -f /var/lib/goat/flaresolverr-libs ]] || fs_libs
    mkdir -p /config/flaresolverr && chown "$PUID:$PGID" /config/flaresolverr
    if ! s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" /opt/goat/bin/flaresolverr-install.sh; then sleep 60; exit 1; fi
    # FlareSolverr reads the browser's version from "chrome --version" and gives up without it. Ask the browser
    # ourselves, the same way, so the real reason shows in the log; missing libraries are added again.
    fs_dir=/config/flaresolverr/app/flaresolverr fs_chrome=/config/flaresolverr/app/flaresolverr/_internal/chrome/chrome
    fs_ver() { s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" env HOME=/config/flaresolverr LD_LIBRARY_PATH="$fs_dir/_internal" "$fs_chrome" --version 2>&1 | head -c 600; }
    v=$(fs_ver)
    if ! grep -Eq '[0-9]+\.[0-9]+\.' <<<"$v"; then
      echo "[goat] FlareSolverr's browser did not start: ${v:-no answer}"
      miss=$(LD_LIBRARY_PATH="$fs_dir/_internal" ldd "$fs_chrome" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' ')
      [[ -n "$miss" ]] && echo "[goat] Libraries it cannot find: $miss"
      rm -f /var/lib/goat/flaresolverr-libs; fs_libs; v=$(fs_ver)
      grep -Eq '[0-9]+\.[0-9]+\.' <<<"$v" || { echo "[goat] FlareSolverr's browser still does not start: ${v:-no answer}. Trying again in 5 minutes."; sleep 300; exit 1; }
    fi
    echo "[goat] FlareSolverr's browser: $v"
    export HOST=127.0.0.1 PORT=8191 HEADLESS=true LOG_LEVEL="${FLARESOLVERR_LOG_LEVEL:-info}" TZ="${TZ:-UTC}"
    cd /config/flaresolverr/app/flaresolverr || exit 1
    cmd=(./flaresolverr) ;;
  plex)
    mkdir -p /config/plex && chown "$PUID:$PGID" /config/plex
    if ! s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" /opt/goat/bin/plex-install.sh; then sleep 60; exit 1; fi
    export PLEX_MEDIA_SERVER_HOME=/config/plex/pms/usr/lib/plexmediaserver
    export PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR="/config/plex/Library/Application Support"
    export PLEX_MEDIA_SERVER_MAX_PLUGIN_PROCS=6 PLEX_MEDIA_SERVER_INFO_VENDOR=Docker PLEX_MEDIA_SERVER_INFO_DEVICE="GoatMediaStackarr"
    export LD_LIBRARY_PATH="$PLEX_MEDIA_SERVER_HOME/lib" TMPDIR=/config/plex/tmp
    mkdir -p "$PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR" /config/plex/tmp && chown "$PUID:$PGID" /config/plex/Library "$PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR" /config/plex/tmp
    # Plex leaves a PID file behind when the container stops; a stale one stops it starting again.
    rm -f "$PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR/Plex Media Server/plexmediaserver.pid"
    cmd=("$PLEX_MEDIA_SERVER_HOME/Plex Media Server") ;;
  ui)
    cd /opt/goat/ui || exit 1
    export HOME=/config/ui PORT=2806 DATA_DIR=/config/ui GOAT_MANAGED=/config/goat/managed.json GOAT_RUN=/run/goat GOAT_WIRED=/config/goat/wired.json
    cmd=(/usr/local/bin/node server.js) ;;
  filebrowser)
    # File Browser: your media and downloads folders in the browser (upload, download, rename, move, delete). It opens
    # through GoatMediaStackarr at /engines/filebrowser/ for admins only, so it has no sign-in of its own.
    export HOME=/config/filebrowser
    fb=/opt/filebrowser/filebrowser db=/config/filebrowser/filebrowser.db
    mkdir -p /config/filebrowser /files && chown "$PUID:$PGID" /config/filebrowser
    ln -sfn "${MEDIA_DIR:-/media}" /files/media; ln -sfn "${DOWNLOADS_DIR:-/downloads}" /files/downloads
    as() { s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" "$@"; }
    opts=(--address 127.0.0.1 --port "${GOAT_PORT_FILEBROWSER:-8095}" --root /files --baseurl /engines/filebrowser --auth.method=noauth)
    if [[ ! -f "$db" ]]; then
      as "$fb" -d "$db" config init "${opts[@]}" >/dev/null && as "$fb" -d "$db" users add goat "$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)" --perm.admin >/dev/null
    else as "$fb" -d "$db" config set "${opts[@]}" >/dev/null; fi
    cmd=("$fb" -d "$db") ;;
  sitefetch)
    export HOME=/config/goat SITEFETCH_PORT=8899
    cmd=(/usr/local/bin/node /opt/goat/bin/sitefetch.js) ;;
  wire)
    export HOME=/config/goat
    # Connects the engines, then stays idle so s6 does not run it again until the next start.
    s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" /usr/local/bin/node /opt/goat/bin/wire.js
    exec sleep infinity ;;
  *) echo "[goat] unknown engine $name"; exec sleep infinity ;;
esac

# PHP's built-in server writes a line for every request, and with several workers "Failed to poll event" whenever a
# worker's wait is interrupted (harmless: it just waits again). Keep those out of the log; real errors still show.
if [[ "$name" == rutorrent-web ]]; then
  exec > >(grep --line-buffered -Ev 'Failed to poll event|:[0-9]+ (Accepted|Closing)$|\]: (GET|POST|HEAD|OPTIONS) ') 2>&1
fi
exec s6-applyuidgid -u "$PUID" -g "$PGID" -G "$groups" "${cmd[@]}"
