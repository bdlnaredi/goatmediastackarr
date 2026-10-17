#!/command/with-contenv bash
# Installs the VPN kill switch before any engine starts. Runs as root, once per container start.
#
# How traffic is split: the apps listed in VPN_APPS run with an extra group (GOAT_VPN_GID).
# Every packet from that group is marked, and marked packets use their own routing table,
# which only has a route through the VPN interface (goatvpn). If the VPN is down that table
# has no usable route and the firewall rejects anything not leaving through goatvpn or loopback,
# so those apps simply lose internet instead of falling back to the home connection.
set -u

GID="${GOAT_VPN_GID:-9000}"
IF=goatvpn
TABLE=5157
MARK=0x5157
FLAG=/run/goat/killswitch-ok
mkdir -p /run/goat && chmod 755 /run/goat
rm -f "$FLAG"

if [ "${VPN_ENABLED,,}" != "true" ]; then
  echo "[goat-vpn] VPN is turned off: every app uses the normal internet connection."
  exit 0
fi

# Docker on some systems only offers the older iptables backend.
if ! iptables -w -t mangle -L -n >/dev/null 2>&1; then
  if iptables-legacy -w -t mangle -L -n >/dev/null 2>&1; then
    update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
  else
    echo "[goat-vpn] ERROR: cannot change the firewall. Add --cap-add=NET_ADMIN to the container (the Unraid template does this)."
    echo "[goat-vpn] The VPN apps (${VPN_APPS:-}) will not start until this is fixed, so nothing leaks."
    exit 0
  fi
fi

FAILED=0
# Any rule that cannot be added means the kill switch is incomplete, so the VPN apps must stay stopped.
must() { "$@" || { echo "[goat-vpn] ERROR: could not run: $*"; FAILED=1; }; }
chain() { # table chain parent
  iptables -w -t "$1" -N "$2" 2>/dev/null || must iptables -w -t "$1" -F "$2"
  iptables -w -t "$1" -C "$3" -j "$2" 2>/dev/null || must iptables -w -t "$1" -I "$3" 1 -j "$2"
}
OWN=(-m owner --gid-owner "$GID" --suppl-groups)

# Mark the VPN apps' packets.
chain mangle GOAT_MARK OUTPUT
must iptables -w -t mangle -A GOAT_MARK "${OWN[@]}" -j MARK --set-mark "$MARK"

# DNS from VPN apps goes to the VPN's DNS server through the tunnel (vpn.sh fills this chain in).
chain nat GOAT_DNS OUTPUT
# Packets that were rerouted into the tunnel still carry the container's own address; give them the tunnel's.
chain nat GOAT_POST POSTROUTING
must iptables -w -t nat -A GOAT_POST -o "$IF" -j MASQUERADE

# Kill switch: VPN apps may only talk to loopback (the other engines) or through the tunnel.
# It sits in POSTROUTING because only there does the outgoing interface reflect the re-route into the tunnel;
# in OUTPUT the interface is still the one picked before the packet was marked.
chain mangle GOAT_KILL POSTROUTING
must iptables -w -t mangle -A GOAT_KILL -m mark --mark "$MARK" -o lo -j RETURN
must iptables -w -t mangle -A GOAT_KILL -m mark --mark "$MARK" -o "$IF" -j RETURN
must iptables -w -t mangle -A GOAT_KILL -m mark --mark "$MARK" -j DROP
if ip6tables -w -L -n >/dev/null 2>&1; then
  ip6tables -w -N GOAT_KILL 2>/dev/null || ip6tables -w -F GOAT_KILL
  ip6tables -w -C OUTPUT -j GOAT_KILL 2>/dev/null || ip6tables -w -I OUTPUT 1 -j GOAT_KILL
  ip6tables -w -A GOAT_KILL "${OWN[@]}" -o lo -j ACCEPT
  ip6tables -w -A GOAT_KILL "${OWN[@]}" -j REJECT
fi

# Routing: loopback always stays local; marked packets use the VPN table, which ends in "unreachable".
while ip rule del pref 90 2>/dev/null; do :; done
while ip rule del pref 100 2>/dev/null; do :; done
must ip rule add pref 90 to 127.0.0.0/8 lookup main
must ip rule add pref 100 fwmark "$MARK" lookup "$TABLE"
must ip route replace unreachable default table "$TABLE" metric 4278198272

# Loose reverse-path checks so replies arriving on the tunnel are accepted (ignored if Docker does not allow it).
sysctl -qw net.ipv4.conf.all.rp_filter=2 2>/dev/null || true
sysctl -qw net.ipv4.conf.all.src_valid_mark=1 2>/dev/null || true

if [ "$FAILED" != 0 ]; then
  echo "[goat-vpn] The kill switch is incomplete, so ${VPN_APPS:-the VPN apps} will not start. Check that the container has NET_ADMIN."
  exit 0
fi
touch "$FLAG"
echo "[goat-vpn] Kill switch active for: ${VPN_APPS:-}. They have no internet until the VPN connects."
