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
PROVIDER="${VPN_PROVIDER:-}"; PROVIDER="${PROVIDER,,}"
# PIA is set up from your username and password over WireGuard; no file is needed.
[ "$PROVIDER" = "pia" ] && TYPE=wireguard
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
    # A container on its own Docker network (docker compose, Docker Desktop) asks Docker's resolver at 127.0.0.11.
    # Sending that question straight into the tunnel would carry 127.0.0.1 as its sender, which Linux refuses to
    # route anywhere but loopback, so every lookup failed. It goes to the small forwarder next to the site browser
    # (sitefetch.js, a VPN app itself), which asks the VPN's DNS server through the tunnel.
    iptables -w -t nat -A GOAT_DNS -m owner --gid-owner "$GID" --suppl-groups -d 127.0.0.0/8 -p "$p" --dport 53 -j DNAT --to-destination "127.0.0.1:${GOAT_DNS_PORT:-5335}"
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
# A tunnel left over from before (this service restarted while OpenVPN was still running) keeps the goatvpn device
# busy, and a new OpenVPN then fails with "Cannot ioctl TUNSETIFF goatvpn: Device or resource busy". Clear it first.
ovpn_clear() {
  local p
  for p in $(pgrep -x openvpn 2>/dev/null); do
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q -- "--dev $IF " && kill "$p" 2>/dev/null
  done
  for _ in $(seq 1 10); do ip link show "$IF" >/dev/null 2>&1 || return 0; sleep 1; done
  ip link del "$IF" 2>/dev/null || true
}
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
  ovpn_clear
  # Our options come after --config so they override the file: fixed interface name, no routes in the main table.
  # --cd: files the .ovpn names without a folder (ca.crt, keys, credentials) are found next to it in the vpn folder.
  openvpn --cd /config/vpn --config "$src" --dev "$IF" --dev-type tun --route-noexec \
    --pull-filter ignore route-ipv6 --pull-filter ignore ifconfig-ipv6 --pull-filter ignore block-outside-dns \
    --script-security 2 --up /opt/goat/bin/ovpn-up.sh --up-restart --down /opt/goat/bin/ovpn-down.sh \
    --connect-retry-max 3 --auth-nocache "${auth[@]}" --verb 3 &
  OVPN_PID=$!
  for _ in $(seq 1 45); do
    [ -f "$RUN/ovpn-ready" ] && break
    kill -0 "$OVPN_PID" 2>/dev/null || { OVPN_PID=""; status error "OpenVPN stopped while connecting. Check the .ovpn file and the VPN_USER / VPN_PASS settings."; return 1; }
    sleep 1
  done
  [ -f "$RUN/ovpn-ready" ] || { ovpn_down; status error "OpenVPN did not connect within 45 seconds."; return 1; }
  set_dns "${VPN_DNS:-$(cat "$RUN/vpn-dns" 2>/dev/null || echo 1.1.1.1)}"
  from_rule "$(cat "$RUN/ovpn-local" 2>/dev/null)"
}
ovpn_down() { [ -n "$OVPN_PID" ] && kill "$OVPN_PID" 2>/dev/null; [ -n "$OVPN_PID" ] && wait "$OVPN_PID" 2>/dev/null; OVPN_PID=""; return 0; }

# When this service is stopped or restarted, take the tunnel down with it, so the next start finds the device free.
# Sleeps run in the background and are waited for, so a stop is handled at once instead of after the sleep.
nap() { sleep "$1" & wait $!; }
stop_all() { trap - TERM INT; log "Stopping"; if [ "$TYPE" = "openvpn" ]; then ovpn_down; ovpn_clear; else wg_down; fi; exit 0; }
trap stop_all TERM INT

# Checks the tunnel the way the VPN apps see it: through their routing table, with their group.
check() {
  local out
  out=$(as_vpn curl -fsS --max-time 10 https://1.1.1.1/cdn-cgi/trace 2>/dev/null) || return 1
  IP=$(printf '%s\n' "$out" | sed -n 's/^ip=//p'); LOC=$(printf '%s\n' "$out" | sed -n 's/^loc=//p')
  [ -n "$IP" ]
}

# Port forwarding: keeps a public port open and gives it to qBittorrent.
# NAT-PMP for ProtonVPN and others; PIA has its own way (a signed port, renewed every 15 minutes through the tunnel).
PORT=""
set_qb_port() {
  local p="$1"
  if [ -n "$p" ] && [ "$p" != "$PORT" ]; then
    if curl -fsS --max-time 5 --data-urlencode "json={\"listen_port\":$p}" http://127.0.0.1:8080/api/v2/app/setPreferences >/dev/null 2>&1; then
      PORT="$p"; log "Forwarded port $p set in qBittorrent."
    fi
  fi
}
PIA_PAYLOAD=""; PIA_SIG=""; PIA_BOUND=0
pia_port() {
  local now out
  now=$(date +%s)
  [ $((now - PIA_BOUND)) -lt 840 ] && [ -n "$PORT" ] && return 0
  out=$(as_vpn env PIA_HOST="$(jq -r .host "$RUN/pia.json")" PIA_VIP="$(jq -r .vip "$RUN/pia.json")" PIA_TOKEN="$(jq -r .token "$RUN/pia.json")" \
        PIA_PAYLOAD="$PIA_PAYLOAD" PIA_SIG="$PIA_SIG" node /opt/goat/bin/pia.js port 2>&1) || { log "PIA port forwarding: $out"; PIA_PAYLOAD=""; PIA_SIG=""; return 0; }
  PIA_PAYLOAD=$(jq -r .payload <<<"$out"); PIA_SIG=$(jq -r .signature <<<"$out"); PIA_BOUND=$now
  set_qb_port "$(jq -r .port <<<"$out")"
}
forward_port() {
  case "${VPN_PORT_FORWARD,,}" in
    pia) [ "$PROVIDER" = "pia" ] && pia_port ;;
    natpmp)
      local gw="${VPN_PF_GATEWAY:-10.2.0.1}" out
      out=$(as_vpn natpmpc -g "$gw" -a 1 0 udp 60 2>/dev/null; as_vpn natpmpc -g "$gw" -a 1 0 tcp 60 2>/dev/null) || true
      set_qb_port "$(printf '%s\n' "$out" | sed -n 's/.*Mapped public port \([0-9]*\).*/\1/p' | tail -n1)" ;;
  esac
  return 0
}

# PIA: sign in, pick the region (the fastest one unless one was chosen) and write a fresh WireGuard file for it.
pia_up() {
  local msg
  msg=$(node /opt/goat/bin/pia.js connect "$RUN/pia.conf" "$RUN/pia.json" 2>&1 >/dev/null) || { status error "${msg##*$'\n'}"; return 1; }
  PIA_PAYLOAD=""; PIA_SIG=""; PIA_BOUND=0
  log "PIA region: $(jq -r .name "$RUN/pia.json")"
  wg_up "$RUN/pia.conf"
}

backoff=5
while true; do
  if [ "$PROVIDER" = "pia" ]; then
    status connecting "Connecting to PIA${VPN_REGION:+ ($VPN_REGION)}"
    log "Connecting to PIA${VPN_REGION:+ ($VPN_REGION)}"
    pia_up || { nap "$backoff"; backoff=$(( backoff < 120 ? backoff * 2 : 120 )); continue; }
    CFG="$RUN/pia.conf"
  else
  CFG=$(find_config)
  if [ -z "$CFG" ]; then
    status waiting "Put your VPN provider's $([ "$TYPE" = openvpn ] && echo .ovpn || echo WireGuard .conf) file in the vpn folder of the app data. VPN apps stay offline until then."
    nap 20; continue
  fi
  status connecting "Connecting with $(basename "$CFG")"
  log "Connecting ($TYPE) with $(basename "$CFG")"
  if [ "$TYPE" = "openvpn" ]; then ovpn_up "$CFG"; else wg_up "$CFG"; fi || { nap "$backoff"; backoff=$(( backoff < 120 ? backoff * 2 : 120 )); continue; }
  fi

  fails=0; n=0
  while true; do
    if check; then
      fails=0; backoff=5
      forward_port   # NAT-PMP leases last 60 seconds, so renew on every check
      status up "Connected${PROVIDER:+ to PIA $(jq -r .name "$RUN/pia.json" 2>/dev/null)}" "$IP" "$LOC" "$PORT"
    else
      fails=$((fails + 1))
      log "Tunnel check failed ($fails/3)"
      [ "$fails" -ge 3 ] && break
    fi
    n=$((n + 1)); nap 30
    [ "$TYPE" = "openvpn" ] && ! kill -0 "$OVPN_PID" 2>/dev/null && break
  done
  status down "Connection lost, reconnecting. VPN apps are offline until it is back."
  log "Reconnecting"
  if [ "$TYPE" = "openvpn" ]; then ovpn_down; else wg_down; fi
  PORT=""; nap "$backoff"
done
