#!/bin/sh
# wg-prepare.sh INPUT.conf > OUTPUT.conf
# Rewrites a VPN provider's WireGuard file for GoatMediaStackarr: routes go into the VPN apps' own table (5157)
# instead of taking over the whole container, IPv6 is dropped (the VPN apps are IPv4 only), and the DNS and
# Up/Down hook lines are removed (vpn.sh handles DNS itself). Plain POSIX awk, because Ubuntu ships mawk.
# FwMark: WireGuard's own encrypted packets get a mark of their own. Without it they keep the VPN apps' mark
# (0x5157), are routed back into the tunnel and loop there, so nothing ever reaches the VPN server.
exec awk '
  { sub(/\r$/, ""); l = tolower($0) }
  l ~ /^[ \t]*\[interface\]/ { print; print "Table = 5157"; print "FwMark = 0x5158"; next }
  l ~ /^[ \t]*(dns|table|fwmark|postup|postdown|preup|predown|saveconfig)[ \t]*=/ { next }
  l ~ /^[ \t]*(address|allowedips)[ \t]*=/ {
    key = substr($0, 1, index($0, "=") - 1); val = substr($0, index($0, "=") + 1)
    n = split(val, parts, ","); out = ""
    for (i = 1; i <= n; i++) { p = parts[i]; gsub(/[ \t]/, "", p); if (p !~ /:/ && p != "") out = out (out == "" ? "" : ",") p }
    sub(/[ \t]+$/, "", key)
    if (out != "") print key " = " out
    next
  }
  { print }
' "$1"
