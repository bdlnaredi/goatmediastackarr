#!/command/with-contenv bash
# Starts one engine as the PUID/PGID user. Apps listed in VPN_APPS also get the VPN group,
# which is what sends their traffic through the tunnel (see vpn-init.sh).
# Settings changed in the interface (settings.json) take priority over the container template.
eval "$(node "$(dirname "$0")/settings.js" env 2>/dev/null)"
set -u
name="$1"
PUID="${PUID:-99}"; PGID="${PGID:-100}"; GID="${GOAT_VPN_GID:-9000}"
in_list() { [[ ",${2// /}," == *",$1,"* ]]; }

if [[ "$name" != ui && "$name" != wire ]] && ! in_list "$name" "${GOAT_ENGINES,,}"; then
  echo "[goat] $name is turned off (GOAT_ENGINES)."
  exec sleep infinity
fi

groups="$PGID"
if [[ "${VPN_ENABLED,,}" == "true" ]] && in_list "$name" "${VPN_APPS,,}"; then
  if [[ ! -f /run/goat/killswitch-ok ]]; then
    echo "[goat] Not starting $name: the VPN kill switch is not active, and $name must only use the VPN."
    sleep 60; exit 1
  fi
  groups="$PGID,$GID"
fi

export HOME="/config/$name"
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
      /usr/local/bin/node /opt/goat/bin/init.js tautulli
    fi
    cmd=(/usr/bin/python3 /opt/tautulli/Tautulli.py --datadir /config/tautulli --config /config/tautulli/config.ini --nolaunch) ;;
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
  wire)
    export HOME=/config/goat
    # Connects the engines, then stays idle so s6 does not run it again until the next start.
    s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID" /usr/local/bin/node /opt/goat/bin/wire.js
    exec sleep infinity ;;
  *) echo "[goat] unknown engine $name"; exec sleep infinity ;;
esac

exec s6-applyuidgid -u "$PUID" -g "$PGID" -G "$groups" "${cmd[@]}"
