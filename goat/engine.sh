#!/command/with-contenv bash
# Starts one engine as the PUID/PGID user. Apps listed in VPN_APPS also get the VPN group,
# which is what sends their traffic through the tunnel (see vpn-init.sh).
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
    cmd=(/opt/bazarr/venv/bin/python bazarr.py --no-update --config /config/bazarr) ;;
  qbittorrent)
    cmd=(/usr/local/bin/qbittorrent-nox --profile=/config/qbittorrent --webui-port=8080) ;;
  sabnzbd)
    cmd=(/opt/sabnzbd/venv/bin/python /opt/sabnzbd/SABnzbd.py --config-file /config/sabnzbd/sabnzbd.ini --browser 0) ;;
  jellyfin)
    cmd=(/usr/bin/jellyfin --datadir /config/jellyfin/data --configdir /config/jellyfin/config
         --cachedir /config/jellyfin/cache --logdir /config/jellyfin/log
         --webdir /usr/share/jellyfin/web --ffmpeg /usr/lib/jellyfin-ffmpeg/ffmpeg) ;;
  seerr)
    cd /opt/seerr || exit 1
    export NODE_ENV=production CONFIG_DIRECTORY=/config/seerr HOST=127.0.0.1 PORT=5055
    cmd=(/usr/local/bin/node dist/index.js) ;;
  tautulli)
    cmd=(/usr/bin/python3 /opt/tautulli/Tautulli.py --datadir /config/tautulli --config /config/tautulli/config.ini --nolaunch) ;;
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
