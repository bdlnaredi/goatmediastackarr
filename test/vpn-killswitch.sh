#!/bin/bash
# Tests goat/vpn-init.sh (the kill switch and split routing) for real, using Linux network namespaces.
# Needs root, ip, iptables, curl and python3. Run: sudo bash test/vpn-killswitch.sh
#
#   box     = the container. eth0 -> "home" (normal internet), goatvpn -> "vpn" (stands in for the tunnel)
#   home    = home internet. Serves 203.0.113.10 and answers "home".
#   vpn     = VPN provider.  Serves the same 203.0.113.10 and answers "vpn"; also a DNS listener on 10.2.0.1:53.
# The same public address exists on both sides, so the answer shows which way a packet really went.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
pass=0; fail=0
ok() { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }
expect() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (expected '$3', got '$2')"; }

cleanup() { for n in box home vpn; do ip netns pids $n 2>/dev/null | xargs -r kill 2>/dev/null; ip netns del $n 2>/dev/null; done; }
trap "[ -z \"${KEEP:-}\" ] && cleanup" EXIT; cleanup

for n in box home vpn; do ip netns add $n; ip -n $n link set lo up; done
ip link add eth0 netns box type veth peer name lan0 netns home
ip link add goatvpn netns box type veth peer name tun0 netns vpn
ip -n box addr add 10.0.0.2/24 dev eth0; ip -n box link set eth0 up
ip -n home addr add 10.0.0.1/24 dev lan0; ip -n home link set lan0 up
ip -n box addr add 10.2.0.2/24 dev goatvpn
ip -n vpn addr add 10.2.0.1/24 dev tun0; ip -n vpn link set tun0 up
ip -n box route add default via 10.0.0.1
for n in home vpn; do ip -n $n addr add 203.0.113.10/32 dev lo; done
ip -n home route add 10.2.0.0/24 via 10.0.0.2 2>/dev/null || true

server() { # namespace answer addr port
  ip netns exec "$1" python3 -c "
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        b = ('$2 ' + s.client_address[0]).encode(); s.send_response(200); s.end_headers(); s.wfile.write(b)
    def log_message(s, *a): pass
http.server.HTTPServer(('$3', $4), H).serve_forever()" &
}
server home home 0.0.0.0 80
server vpn vpn 0.0.0.0 80
server box local 127.0.0.1 8989
ip netns exec vpn python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('10.2.0.1', 53))
while True:
    d, a = s.recvfrom(512); open('/tmp/goat-dns-hit', 'w').write(a[0]); s.sendto(d, a)" &
rm -f /tmp/goat-dns-hit
sleep 1

BOX=(ip netns exec box)
AS_VPN=(setpriv --reuid 99 --regid 100 --groups 100,9000)
AS_APP=(setpriv --reuid 99 --regid 100 --groups 100)
get() { "${BOX[@]}" "$@" curl -s --max-time 3 http://203.0.113.10/ 2>/dev/null | cut -d' ' -f1; }

echo "Before the kill switch (VPN app would leak):"
expect "VPN app reaches home internet" "$(get "${AS_VPN[@]}")" "home"

echo "Kill switch on, tunnel not connected yet:"
"${BOX[@]}" env VPN_ENABLED=true VPN_APPS=qbittorrent bash "$HERE/goat/vpn-init.sh" | sed 's/^/  | /'
"${BOX[@]}" test -f /run/goat/killswitch-ok && ok "kill switch flag written" || bad "kill switch flag missing"
expect "VPN app gets no internet at all" "$(get "${AS_VPN[@]}")" ""
expect "normal app still uses home internet" "$(get "${AS_APP[@]}")" "home"
expect "VPN app can still reach other engines on localhost" "$("${BOX[@]}" "${AS_VPN[@]}" curl -s --max-time 3 http://127.0.0.1:8989/ | cut -d' ' -f1)" "local"

echo "Tunnel connected (what wg-quick / the OpenVPN hook add):"
"${BOX[@]}" ip link set goatvpn up
"${BOX[@]}" ip route replace default via 10.2.0.1 dev goatvpn table 5157
"${BOX[@]}" ip rule add pref 95 from 10.2.0.2 lookup 5157
expect "VPN app goes through the VPN" "$(get "${AS_VPN[@]}")" "vpn"
expect "VPN provider sees the tunnel address" "$("${BOX[@]}" "${AS_VPN[@]}" curl -s --max-time 3 http://203.0.113.10/ | cut -d' ' -f2)" "10.2.0.2"
expect "normal app still uses home internet" "$(get "${AS_APP[@]}")" "home"
expect "root (the VPN connection itself) uses home internet" "$(get)" "home"

echo "DNS from VPN apps goes to the VPN's DNS server:"
"${BOX[@]}" iptables -w -t nat -A GOAT_DNS -m owner --gid-owner 9000 --suppl-groups -p udp --dport 53 -j DNAT --to-destination 10.2.0.1:53
"${BOX[@]}" "${AS_VPN[@]}" python3 -c "
import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2); s.sendto(b'x', ('192.0.2.53', 53)); print(s.recv(10))" >/dev/null 2>&1
expect "DNS query reached the VPN's DNS through the tunnel" "$(cat /tmp/goat-dns-hit 2>/dev/null)" "10.2.0.2"

echo "Tunnel drops:"
"${BOX[@]}" ip link set goatvpn down
expect "VPN app loses internet instead of leaking" "$(get "${AS_VPN[@]}")" ""
expect "normal app unaffected" "$(get "${AS_APP[@]}")" "home"
"${BOX[@]}" ip link set goatvpn up
"${BOX[@]}" ip route replace default via 10.2.0.1 dev goatvpn table 5157
expect "VPN app back through the VPN after reconnect" "$(get "${AS_VPN[@]}")" "vpn"

echo "Running the kill switch again (container restart) keeps one copy of each rule:"
"${BOX[@]}" env VPN_ENABLED=true bash "$HERE/goat/vpn-init.sh" >/dev/null
expect "single jump into GOAT_KILL" "$("${BOX[@]}" iptables -t mangle -S POSTROUTING | grep -c GOAT_KILL)" "1"
expect "single fwmark rule" "$("${BOX[@]}" ip rule | grep -c 'fwmark 0x5157')" "1"
expect "single MARK rule" "$("${BOX[@]}" iptables -t mangle -S GOAT_MARK | grep -c -- "-j MARK")" "1"

echo "VPN turned off:"
"${BOX[@]}" rm -f /run/goat/killswitch-ok
out=$("${BOX[@]}" env VPN_ENABLED=false bash "$HERE/goat/vpn-init.sh")
case "$out" in *"turned off"*) ok "reports VPN off and adds nothing";; *) bad "unexpected output: $out";; esac

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
