#!/command/with-contenv bash
# First step at every start (as root): folders, keys and engine settings.
set -e
mkdir -p /run/goat && chmod 755 /run/goat
PUID="${PUID:-99}"; PGID="${PGID:-100}"
echo "[goat] GoatMediaStackarr $(cat /opt/goat/VERSION 2>/dev/null) starting as user ${PUID}:${PGID}"
# Which apps run: the template's switch per app (GOAT_APP_SONARR=true…) with the older Apps to run list
# (GOAT_ENGINES). Worked out once here and handed to every app and script that starts after this.
if GOAT_ENGINES="$(/usr/local/bin/node /opt/goat/bin/engines.js enabled)"; then
  export GOAT_ENGINES
  [ -d /run/s6/container_environment ] && printf '%s' "$GOAT_ENGINES" > /run/s6/container_environment/GOAT_ENGINES
  echo "[goat] Apps to run: ${GOAT_ENGINES//,/, }"
fi
case "${GOAT_APP_FILEBROWSER:-}" in
  [Ff]alse|[Nn]o|[Oo]ff|0) export GOAT_FILEBROWSER=false; [ -d /run/s6/container_environment ] && printf false > /run/s6/container_environment/GOAT_FILEBROWSER ;;
esac
# Name lookups: make sure TMDB and GitHub can be found (see dns.js); never holds up the start for long.
timeout 30 /usr/local/bin/node /opt/goat/bin/dns.js || true
/usr/local/bin/node /opt/goat/bin/init.js
# Before an update: the settings of each app whose version changed are backed up before it starts (see preupdate.js).
timeout 900 /usr/local/bin/node /opt/goat/bin/preupdate.js || true
# Seerr and Bazarr write a few files next to their own code.
chown -R "$PUID:$PGID" /opt/seerr/.next /opt/seerr/config /opt/bazarr 2>/dev/null || true
