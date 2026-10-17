#!/bin/bash
# Called by OpenVPN once the tunnel is up: route the VPN apps' table through it and note the VPN's DNS server.
ip route replace default dev "$dev" table 5157
echo "${ifconfig_local:-}" > /run/goat/ovpn-local
for v in ${!foreign_option_*}; do
  o="${!v}"
  case "$o" in
    "dhcp-option DNS "*) d="${o#dhcp-option DNS }"; if [[ "$d" != *:* ]]; then echo "$d" > /run/goat/vpn-dns; break; fi ;;
  esac
done
touch /run/goat/ovpn-ready
