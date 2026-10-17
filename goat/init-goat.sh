#!/command/with-contenv bash
# First step at every start (as root): folders, keys and engine settings.
set -e
mkdir -p /run/goat && chmod 755 /run/goat
PUID="${PUID:-99}"; PGID="${PGID:-100}"
echo "[goat] GoatMediaStackarr $(cat /opt/goat/VERSION 2>/dev/null) starting as user ${PUID}:${PGID}"
/usr/local/bin/node /opt/goat/bin/init.js
# Seerr and Bazarr write a few files next to their own code.
chown -R "$PUID:$PGID" /opt/seerr/.next /opt/seerr/config /opt/bazarr 2>/dev/null || true
