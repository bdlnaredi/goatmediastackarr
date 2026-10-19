#!/bin/bash
# Tests the kill switch with a real WireGuard tunnel (not a stand-in), the way the container uses it: vpn-init.sh,
# then wg-prepare.sh and wg-quick with the VPN apps' own routing table. Needs root, the wireguard kernel module,
# wireguard-tools, iptables, curl and python3. Run: sudo bash test/vpn-wireguard.sh
#
#   box  = the container. eth0 -> srv (its normal internet), goatvpn = WireGuard tunnel to srv
#   srv  = the internet and the VPN server at once. It answers http://203.0.113.10/ with the address it sees, so
#          10.2.0.2 means "came through the tunnel" and 10.0.0.2 means "came the normal way".
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
pass=0; fail=0
ok() { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=WireGuard test::$1"; fail=$((fail+1)); }
expect() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$3', got '$2')"; }

cleanup() { for n in box srv; do ip netns pids $n 2>/dev/null | xargs -r kill 2>/dev/null; ip netns del $n 2>/dev/null; done; }
trap "[ -z \"${KEEP:-}\" ] && cleanup" EXIT; cleanup

ip netns add probe && if ! ip -n probe link add wgt type wireguard 2>/dev/null; then ip netns del probe; echo "No WireGuard in this kernel: skipped."; exit 0; fi; ip netns del probe

for n in box srv; do ip netns add $n; ip -n $n link set lo up; done
ip link add eth0 netns box type veth peer name lan0 netns srv
ip -n box addr add 10.0.0.2/24 dev eth0; ip -n box link set eth0 up
ip -n srv addr add 10.0.0.1/24 dev lan0; ip -n srv link set lan0 up
ip -n box route add default via 10.0.0.1
ip -n srv addr add 203.0.113.10/32 dev lo

# The VPN server side.
SK=$(wg genkey); SP=$(echo "$SK" | wg pubkey); CK=$(wg genkey); CP=$(echo "$CK" | wg pubkey)
ip -n srv link add wg0 type wireguard
ip netns exec srv wg set wg0 private-key <(echo "$SK") listen-port 51820 peer "$CP" allowed-ips 10.2.0.2/32
ip -n srv addr add 10.2.0.1/24 dev wg0; ip -n srv link set wg0 up

ip netns exec srv python3 -c "
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        b = s.client_address[0].encode(); s.send_response(200); s.send_header('Content-Length', str(len(b))); s.end_headers(); s.wfile.write(b)
    def log_message(s, *a): pass
http.server.ThreadingHTTPServer(('0.0.0.0', 80), H).serve_forever()" &
sleep 1

BOX=(ip netns exec box)
AS_VPN=(setpriv --reuid 99 --regid 100 --groups 100,9000)
AS_APP=(setpriv --reuid 99 --regid 100 --groups 100)
get() { "${BOX[@]}" "$@" curl -s --max-time 4 http://203.0.113.10/ 2>/dev/null; }

echo "Kill switch on:"
"${BOX[@]}" env VPN_ENABLED=true VPN_APPS=qbittorrent bash "$HERE/goat/vpn-init.sh" | sed 's/^/  | /'
expect "VPN app has no internet before the tunnel" "$(get "${AS_VPN[@]}")" ""

echo "WireGuard tunnel up (a provider file, prepared the way vpn.sh does it):"
mkdir -p /run/goat
printf '[Interface]\nPrivateKey = %s\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 10.0.0.1:51820\nPersistentKeepalive = 25\n' "$CK" "$SP" > /tmp/goat-wg-src.conf
"${BOX[@]}" sh "$HERE/goat/wg-prepare.sh" /tmp/goat-wg-src.conf > /run/goat/goatvpn.conf; chmod 600 /run/goat/goatvpn.conf
sed 's/^/  | /' /run/goat/goatvpn.conf | grep -v PrivateKey
"${BOX[@]}" wg-quick up /run/goat/goatvpn.conf 2>&1 | sed 's/^/  | /'
"${BOX[@]}" ip rule add pref 95 from 10.2.0.2 lookup 5157

expect "VPN app goes through the tunnel" "$(get "${AS_VPN[@]}")" "10.2.0.2"
expect "normal app uses the normal connection" "$(get "${AS_APP[@]}")" "10.0.0.2"
expect "root uses the normal connection" "$(get)" "10.0.0.2"
# A bigger download through the tunnel, so a loop or a drop shows up in the byte counts.
n=$("${BOX[@]}" "${AS_VPN[@]}" sh -c 'curl -s --max-time 10 http://203.0.113.10/ -o /dev/null -w "%{http_code}"; for i in 1 2 3 4 5; do curl -s --max-time 4 http://203.0.113.10/ >/dev/null; done; echo')
expect "repeated requests through the tunnel work" "$n" "200"
read -r rx tx < <("${BOX[@]}" wg show goatvpn transfer | awk '{print $2, $3}')
echo "  | tunnel bytes: received $rx, sent $tx"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=WireGuard bytes::received $rx, sent $tx"
[ "${tx:-0}" -lt 2000000 ] && ok "no packet loop (sent $tx bytes)" || bad "packet loop: $tx bytes sent for a few small requests"
[ "${rx:-0}" -gt 1000 ] && ok "answers come back through the tunnel (received $rx bytes)" || bad "nothing comes back through the tunnel (received $rx bytes)"
note() { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice title=$1::$(tr '\n' ';' | tr -s ' ')"; }
"${BOX[@]}" iptables -t mangle -L GOAT_KILL -v -n | tee >(note "GOAT_KILL counters") | sed 's/^/  | /'
"${BOX[@]}" iptables -t nat -L GOAT_POST -v -n | tee >(note "GOAT_POST counters") | sed 's/^/  | /'
"${BOX[@]}" ip rule | tee >(note "ip rules") | sed 's/^/  | /'
"${BOX[@]}" wg show goatvpn | tee >(note "wg show") | sed 's/^/  | /'

echo "Tunnel down:"
"${BOX[@]}" wg-quick down /run/goat/goatvpn.conf >/dev/null 2>&1
expect "VPN app loses internet instead of leaking" "$(get "${AS_VPN[@]}")" ""
expect "normal app unaffected" "$(get "${AS_APP[@]}")" "10.0.0.2"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
