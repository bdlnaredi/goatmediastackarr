#!/bin/bash
# Scans a built image for known security holes (CVEs) with Trivy.
#   scan-image.sh IMAGE report OUT.sarif   every hole found, as a SARIF file for GitHub's Security tab (never fails)
#   scan-image.sh IMAGE block              fails when there is a CRITICAL hole that already has a fixed version
# IMAGE is a local image (goat:ci) or one in a registry (ghcr.io/…@sha256:…, signed in with docker login).
# Holes listed in .trivyignore (one CVE id per line, with a comment saying why) are left out of both.
set -euo pipefail
img="$1"; mode="$2"
TRIVY_VERSION=0.76.2

if ! command -v trivy >/dev/null; then
  case "$(uname -m)" in x86_64) a=64bit ;; aarch64|arm64) a=ARM64 ;; *) echo "scan-image: unknown processor $(uname -m)"; exit 1 ;; esac
  base="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}"
  f="trivy_${TRIVY_VERSION}_Linux-${a}.tar.gz"
  tmp=$(mktemp -d)
  curl -fsSL --retry 4 -o "$tmp/$f" "$base/$f"
  curl -fsSL --retry 4 -o "$tmp/sums.txt" "$base/trivy_${TRIVY_VERSION}_checksums.txt"
  # Only a download that matches the release's own checksum is used.
  (cd "$tmp" && grep " ${f}\$" sums.txt | sha256sum -c -) || { echo "::error::The Trivy download does not match its checksum"; exit 1; }
  tar -xzf "$tmp/$f" -C "$tmp" trivy && sudo install -m 755 "$tmp/trivy" /usr/local/bin/trivy && rm -rf "$tmp"
fi
trivy --version | head -1

common=(image --scanners vuln --timeout 45m --quiet)
[[ -f .trivyignore ]] && common+=(--ignorefile .trivyignore)

case "$mode" in
  report)
    out="${3:-trivy.sarif}"
    trivy "${common[@]}" --format sarif --output "$out" "$img" || { echo "::warning::The security scan did not finish"; echo '{"version":"2.1.0","runs":[]}' > "$out"; }
    # A short count on the run's page too.
    trivy "${common[@]}" --format json --output /tmp/trivy.json --skip-db-update "$img" >/dev/null 2>&1 || true
    if [[ -s /tmp/trivy.json ]]; then
      for s in CRITICAL HIGH MEDIUM LOW; do
        n=$(jq "[.Results[]?.Vulnerabilities[]? | select(.Severity==\"$s\")] | length" /tmp/trivy.json)
        fixed=$(jq "[.Results[]?.Vulnerabilities[]? | select(.Severity==\"$s\" and (.FixedVersion // \"\") != \"\")] | length" /tmp/trivy.json)
        echo "::notice::Security scan: $n $s ($fixed with a fix available)"
      done
    fi
    ;;
  block)
    # Only what can be fixed by updating: a hole nobody has fixed yet cannot be fixed here either.
    if ! trivy "${common[@]}" --severity CRITICAL --ignore-unfixed --exit-code 1 --format table "$img" | tee /tmp/trivy-block.txt; then
      grep -oE 'CVE-[0-9]{4}-[0-9]+' /tmp/trivy-block.txt | sort -u | head -20 | sed 's/^/::error title=Critical security hole with a fix::/' || true
      echo "::error::The image has critical security holes that already have fixes (listed above). Update the part named, or, if it does not apply here, add the CVE to .trivyignore with the reason."
      exit 1
    fi
    ;;
  *) echo "scan-image: mode is report or block"; exit 1 ;;
esac
