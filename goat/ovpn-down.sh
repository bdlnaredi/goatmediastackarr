#!/bin/bash
# Called by OpenVPN when the tunnel goes down. The VPN table falls back to "unreachable", so nothing leaks.
rm -f /run/goat/ovpn-ready
ip route del default dev "$dev" table 5157 2>/dev/null || true
