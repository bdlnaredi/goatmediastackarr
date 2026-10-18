#!/command/with-contenv bash
# Keeps the VPN tunnel up for the apps in VPN_APPS. Runs as root under s6 and never exits on its own.
# Supports WireGuard (a .conf file) and OpenVPN (a .ovpn file) placed in /config/vpn.
# Writes its state to /run/goat/vpn.json for the GoatMediaStackarr dashboard.
# Settings changed in the interface (settings.json) take priority over the container template.
eval "$(node "$(dirname "$0")/settings.js" env 2>/dev/null)"
set -u

GID="${GOAT_VPN_GID:-9000}"
IF=goatvpn
TABLE=5157
RUN=/run/goat
STATUS=$RUN/vpn.json
PUID="${PUID:-99}"; PGID="${PGID:-100}"
TYPE="${VPN_TYPE:-wireguard}"; TYPE="${TYPE,,}"
mkdir -p "$RUN" && chmod 755 "$RUN"

log() { echo "[goat-vpn] $*"; }
status() { # state message [ip] [country] [port]
  jq -n --arg state "$1" --arg msg "$2" --arg ip "${3:-}" --arg country "${4:-}" --arg port "${5:-}" \
        --arg type "$TYPE" --arg apps "${VPN_APPS:-}" --argjson since "$(date +%s)" \
        '{enabled:true, state:$state, message:$msg, ip:$ip, country:$country, port:$port, type:$type, apps:($apps|split(",")), since:$since}' \
        > "$STATUS.tmp" && chmod 644 "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}
# Runs a command the same way the VPN apps run, so it takes the same path they do.
as_vpn() { s6-applyuidgid -u "$PUID" -g "$PGID" -G "$PGID,$GID" "$@"; }

if [ "${VPN_ENABLED,,}" != "true" ]; then
  echo '{"enabled":false,"state":"off"}' > "$STATUS"; chmod 644 "$STATUS"
  exec sleep infinity
fi
if [ ! -f "$RUN/killswitch-ok" ]; then
  status error "The kill switch could not be set up (missing NET_ADMIN). VPN apps are held stopped."
  exec sleep infinity
fi

find_config() {
  local ext=conf; [ "$TYPE" = "openvpn" ] && ext=ovpn
  find /config/vpn -maxdepth 1 -type f -iname "*.$ext" | sort | head -n1
}

set_dns() { # point the VPN apps' DNS at the tunnel's DNS server
  local dns="$1"
  iptables -w -t nat -F GOAT_DNS
  for p in udp tcp; do
    iptables -w -t nat -A GOAT_DNS -m owner --gid-owner "$GID" --suppl-groups -p "$p" --dport 53 -j DNAT --to-destination "$dns:53"
  done
  echo "$dns" > "$RUN/vpn-dns"
}

from_rule() { # replies sent from the tunnel address always go back through the tunnel
  while ip rule del pref 95 2>/dev/null; do :; done
  [ -n "${1:-}" ] && ip rule add pref 95 from "$1" lookup "$TABLE"
}

wg_up() {
  local src="$1" cfg="$RUN/$IF.conf"
  /opt/goat/bin/wg-prepare.sh "$src" > "$cfg"
  chmod 600 "$cfg"
  local dns addr
  dns=$(grep -iE '^\s*DNS\s*=' "$src" | head -n1 | cut -d= -f2 | tr ',' '\n' | tr -d ' \r' | grep -v ':' | head -n1)
  addr=$(grep -iE '^\s*Address\s*=' "$cfg" | head -n1 | cut -d= -f2 | tr ',' '\n' | tr -d ' \r' | head -n1 | cut -d/ -f1)
  wg-quick down "$cfg" >/dev/null 2>&1 || true
  if ! wg-quick up "$cfg"; then
    if ! ip link add dev wgtest type wireguard 2>/dev/null; then
      status error "WireGuard is not available in this server's kernel. Use an OpenVPN config instead (VPN_TYPE=openvpn)."
    else
      ip link del wgtest; status error "WireGuard could not connect with $(basename "$src"). Check the file from your VPN provider."
    fi
    return 1
  fi
  set_dns "${VPN_DNS:-${dns:-1.1.1.1}}"
  from_rule "$addr"
}

wg_down() { wg-quick down "$RUN/$IF.conf" >/dev/null 2>&1 || true; }

OVPN_PID=""
ovpn_up() {
  local src="$1" auth=()
  if [ -n "${VPN_USER:-}" ]; then
    printf '%s\n%s\n' "$VPN_USER" "${VPN_PASS:-}" > "$RUN/vpn-auth"; chmod 600 "$RUN/vpn-auth"; auth=(--auth-user-pass "$RUN/vpn-auth")
  elif [ -f /config/vpn/credentials.conf ]; then
    auth=(--auth-user-pass /config/vpn/credentials.conf)
  else
    # The file asks for a username and password. It may name its own file for them (e.g. "auth-user-pass credentials.conf"),
    # which is looked for next to the .ovpn file; without one, say what to do instead of letting OpenVPN fail.
    local want
    want=$(grep -iE '^[[:space:]]*auth-user-pass([[:space:]]|$)' "$src" | head -n1 | tr -d '\r' | awk '{print $2}')
    if grep -qiE '^[[:space:]]*auth-user-pass([[:space:]]|$)' "$src" && { [ -z "$want" ] || [ ! -f "/config/vpn/$want" -a ! -f "$want" ]; }; then
      status error "Your .ovpn file needs your VPN username and password. Enter them on the Stack page under VPN (or set VPN_USER and VPN_PASS), then press Save and apply."
      return 1
    fi
  fi
  rm -f "$RUN/ovpn-ready"
  # Our options come after --config so they override the file: fixed interface name, no routes in the main table.
  # --cd: files the .ovpn names without a folder (ca.crt, keys, credentials) are found next to it in the vpn folder.
  openvpn --cd /config/vpn --config "$src" --dev "$IF" --dev-type tun --route-noexec \
    --pull-filter ignore route-ipv6 --pull-filter ignore ifconfig-ipv6 --pull-filter ignore block-outside-dns \
    --script-security 2 --up /opt/goat/bin/ovpn-up.sh --up-restart --down /opt/goat/bin/ovpn-down.sh \
    --connect-retry-max 3 --auth-nocache "${auth[@]}" --verb 3 &
  OVPN_PID=$!
  for _ in $(seq 1 45); do
    [ -f "$RUN/ovpn-ready" ] && break
    kill -0 "$OVPN_PID" 2>/dev/null || { status error "OpenVPN stopped while connecting. Check the .ovpn file and the VPN_USER / VPN_PASS settings."; return 1; }
    sleep 1
  done
  [ -f "$RUN/ovpn-ready" ] || { status error "OpenVPN did not connect within 45 seconds."; return 1; }
  set_dns "${VPN_DNS:-$(cat "$RUN/vpn-dns" 2>/dev/null || echo 1.1.1.1)}"
  from_rule "$(cat "$RUN/ovpn-local" 2>/dev/null)"
}
ovpn_down() { [ -n "$OVPN_PID" ] && kill "$OVPN_PID" 2>/dev/null; wait "$OVPN_PID" 2>/dev/null; OVPN_PID=""; }

# Checks the tunnel the way the VPN apps see it: through their routing table, with their group.
check() {
  local out
  out=$(as_vpn curl -fsS --max-time 10 https://1.1.1.1/cdn-cgi/trace 2>/dev/null) || return 1
  IP=$(printf '%s\n' "$out" | sed -n 's/^ip=//p'); LOC=$(printf '%s\n' "$out" | sed -n 's/^loc=//p')
  [ -n "$IP" ]
}

# NAT-PMP port forwarding (ProtonVPN and others): keeps a public port open and gives it to qBittorrent.
PORT=""
forward_port() {
  [ "${VPN_PORT_FORWARD,,}" = "natpmp" ] || return 0
  local gw="${VPN_PF_GATEWAY:-10.2.0.1}" out p
  out=$(as_vpn natpmpc -g "$gw" -a 1 0 udp 60 2>/dev/null; as_vpn natpmpc -g "$gw" -a 1 0 tcp 60 2>/dev/null) || true
  p=$(printf '%s\n' "$out" | sed -n 's/.*Mapped public port \([0-9]*\).*/\1/p' | tail -n1)
  if [ -n "$p" ] && [ "$p" != "$PORT" ]; then
    if curl -fsS --max-time 5 --data-urlencode "json={\"listen_port\":$p}" http://127.0.0.1:8080/api/v2/app/setPreferences >/dev/null 2>&1; then
      PORT="$p"; log "Forwarded port $p set in qBittorrent."
    fi
  fi
}

backoff=5
while true; do
  CFG=$(find_config)
  if [ -z "$CFG" ]; then
    status waiting "Put your VPN provider's $([ "$TYPE" = openvpn ] && echo .ovpn || echo WireGuard .conf) file in the vpn folder of the app data. VPN apps stay offline until then."
    sleep 20; continue
  fi
  status connecting "Connecting with $(basename "$CFG")"
  log "Connecting ($TYPE) with $(basename "$CFG")"
  if [ "$TYPE" = "openvpn" ]; then ovpn_up "$CFG"; else wg_up "$CFG"; fi || { sleep "$backoff"; backoff=$(( backoff < 120 ? backoff * 2 : 120 )); continue; }

  fails=0; n=0
  while true; do
    if check; then
      fails=0; backoff=5
      forward_port   # NAT-PMP leases last 60 seconds, so renew on every check
      status up "Connected" "$IP" "$LOC" "$PORT"
    else
      fails=$((fails + 1))
      log "Tunnel check failed ($fails/3)"
      [ "$fails" -ge 3 ] && break
    fi
    n=$((n + 1)); sleep 30
    [ "$TYPE" = "openvpn" ] && ! kill -0 "$OVPN_PID" 2>/dev/null && break
  done
  status down "Connection lost, reconnecting. VPN apps are offline until it is back."
  log "Reconnecting"
  if [ "$TYPE" = "openvpn" ]; then ovpn_down; else wg_down; fi
  PORT=""; sleep "$backoff"
done
