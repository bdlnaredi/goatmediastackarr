# GoatMediaStackarr: one container that runs a whole media stack.
# Engines are the official open-source releases, fetched at build time and run side by side under s6-overlay.

ARG NODE_VERSION=22

# ---------- Seerr is built from source on glibc so it runs on the Ubuntu base below ----------
FROM node:${NODE_VERSION}-bookworm AS seerr
ARG SEERR_VERSION=v3.5.0
ENV CYPRESS_INSTALL_BINARY=0 CI=true
RUN corepack enable && \
    git clone --depth 1 --branch "${SEERR_VERSION}" https://github.com/seerr-team/seerr /app
WORKDIR /app
RUN pnpm install --frozen-lockfile && \
    pnpm build && \
    rm -rf .next/cache && \
    pnpm prune --prod && \
    # Source maps, tests and docs are not needed to run it.
    find . -name '*.map' -not -path './.git/*' -delete && rm -rf .git cypress docs && \
    echo "{\"commitTag\": \"${SEERR_VERSION}\"}" > committag.json

# ---------- Bazarr and SABnzbd with their Python packages, built with compilers the final image never carries ----------
FROM ubuntu:24.04 AS python
ARG TARGETARCH
ARG BAZARR_VERSION=latest
ARG SABNZBD_VERSION=latest
ENV DEBIAN_FRONTEND=noninteractive
COPY goat/fetch-release.sh /usr/local/bin/fetch-release
RUN chmod +x /usr/local/bin/fetch-release && apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl jq unzip python3 python3-venv python3-dev build-essential libxml2-dev libxslt1-dev
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    fetch-release morpheus65535/bazarr "${BAZARR_VERSION}" '^bazarr\.zip$' /tmp/bazarr.zip && \
    mkdir -p /opt/bazarr && unzip -q /tmp/bazarr.zip -d /opt/bazarr && rm /tmp/bazarr.zip && \
    python3 -m venv /opt/bazarr/venv && \
    /opt/bazarr/venv/bin/pip install --no-cache-dir -r /opt/bazarr/requirements.txt
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    fetch-release sabnzbd/sabnzbd "${SABNZBD_VERSION}" '^SABnzbd-.*-(src|source)\.tar\.gz$' /tmp/sab.tar.gz && \
    mkdir -p /opt/sabnzbd && tar -xzf /tmp/sab.tar.gz -C /opt/sabnzbd --strip-components=1 && rm /tmp/sab.tar.gz && \
    python3 -m venv /opt/sabnzbd/venv && \
    /opt/sabnzbd/venv/bin/pip install --no-cache-dir -r /opt/sabnzbd/requirements.txt && \
    (cd /opt/sabnzbd && /opt/sabnzbd/venv/bin/python tools/make_mo.py >/dev/null 2>&1 || true)
# Compiled caches are rebuilt when needed.
RUN find /opt/bazarr /opt/sabnzbd -name __pycache__ -prune -exec rm -rf {} +

# ---------- Node runtime for the GoatMediaStackarr UI, the wiring script and Seerr ----------
FROM node:${NODE_VERSION}-bookworm-slim AS node

# ---------- Final image ----------
FROM ubuntu:24.04

# amd64 (Intel/AMD) or arm64 (Raspberry Pi 4/5, Apple-silicon hosts, ARM servers); set by docker buildx.
ARG TARGETARCH
ARG VERSION=dev
# Each engine version can be pinned at build time (--build-arg SONARR_VERSION=v4.0.0.1); "latest" takes the newest stable release.
ARG S6_OVERLAY_VERSION=latest
ARG SONARR_VERSION=latest
ARG RADARR_VERSION=latest
ARG LIDARR_VERSION=latest
ARG PROWLARR_VERSION=latest
ARG TAUTULLI_VERSION=latest
ARG QBITTORRENT_TAG=latest

LABEL org.opencontainers.image.title="GoatMediaStackarr" \
      org.opencontainers.image.description="A whole self-hosted media stack in one container: Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, qBittorrent, SABnzbd, Jellyfin, Seerr and Tautulli behind one interface, with a built-in VPN" \
      org.opencontainers.image.source="https://github.com/bdlnaredi/goatmediastackarr" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.version="${VERSION}" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/bdlnaredi/goatmediastackarr/main/ui/public/icon-192.png" \
      net.unraid.docker.webui="http://[IP]:[PORT:2806]/"

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=0 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_KILL_GRACETIME=10000 \
    S6_VERBOSITY=1 \
    PUID=99 \
    PGID=100 \
    UMASK=002 \
    TZ=Etc/UTC \
    MEDIA_DIR=/media \
    DOWNLOADS_DIR=/downloads \
    GOAT_ENGINES=sonarr,radarr,lidarr,prowlarr,bazarr,qbittorrent,sabnzbd,jellyfin,seerr \
    PLEX_UPDATE=true \
    VPN_ENABLED=false \
    VPN_TYPE=wireguard \
    VPN_APPS=qbittorrent,sabnzbd,prowlarr \
    LAN_NETWORK= \
    VPN_PORT_FORWARD=off \
    GOAT_VERSION=${VERSION}

COPY goat/fetch-release.sh /usr/local/bin/fetch-release

# System packages: networking/VPN tools, Python for Bazarr/SABnzbd/Tautulli, .NET runtime needs, unpackers for SABnzbd.
RUN chmod +x /usr/local/bin/fetch-release && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl jq gnupg tzdata xz-utils \
      iproute2 iptables wireguard-tools openvpn natpmpc procps \
      libicu74 libsqlite3-0 sqlite3 mediainfo \
      python3 python3-venv libxml2 libxslt1.1 \
      par2 7zip unrar && \
    install -d /etc/apt/keyrings && \
    curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/ubuntu noble main" > /etc/apt/sources.list.d/jellyfin.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends jellyfin-server jellyfin-web && \
    # Newer Jellyfin no longer pulls in its ffmpeg automatically, and refuses to start without one: install the newest.
    ff=$(apt-cache search --names-only '^jellyfin-ffmpeg[0-9]*$' | awk '{print $1}' | sort -V | tail -n1) && \
    echo "Installing $ff" && apt-get install -y --no-install-recommends "$ff" && \
    test -x /usr/lib/jellyfin-ffmpeg/ffmpeg && /usr/lib/jellyfin-ffmpeg/ffmpeg -hide_banner -version | head -n1 && \
    # Bazarr needs ffmpeg and ffprobe. Its download only has them for x86, so on ARM it would refuse to start;
    # give it Jellyfin's, which exist on both.
    for b in ffmpeg ffprobe; do test -x "/usr/lib/jellyfin-ffmpeg/$b" && ln -sf "/usr/lib/jellyfin-ffmpeg/$b" "/usr/local/bin/$b" || exit 1; done && \
    apt-get purge -y gnupg && apt-get autoremove -y && \
    find /usr/share/doc -type f ! -name copyright -delete && rm -rf /var/lib/apt/lists/* /var/cache/apt /usr/share/man/*

# s6-overlay (process supervisor that keeps every engine running and restarts the one that stops).
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    fetch-release just-containers/s6-overlay "${S6_OVERLAY_VERSION}" '^s6-overlay-noarch\.tar\.xz$' /tmp/s6-noarch.tar.xz && \
    a=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    fetch-release just-containers/s6-overlay "${S6_OVERLAY_VERSION}" "^s6-overlay-${a}\.tar\.xz$" /tmp/s6-arch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-noarch.tar.xz && tar -C / -Jxpf /tmp/s6-arch.tar.xz && rm /tmp/s6-*.tar.xz

# Sonarr, Radarr, Lidarr, Prowlarr: official self-contained .NET builds for glibc. Each carries its own copy of
# the .NET runtime; identical files are hardlinked in the same step, so the image stores them only once.
COPY goat/dedupe.py /usr/local/bin/dedupe
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    set -e; a=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64); \
    for app in "Sonarr ${SONARR_VERSION}" "Radarr ${RADARR_VERSION}" "Lidarr ${LIDARR_VERSION}" "Prowlarr ${PROWLARR_VERSION}"; do \
      set -- $app; name=$1; tag=$2; low=$(echo "$name" | tr 'A-Z' 'a-z'); \
      fetch-release "$name/$name" "$tag" "^${name}\..*linux(-core)?-${a}\.tar\.gz$" "/tmp/$low.tar.gz"; \
      mkdir -p "/opt/$low" && tar -xzf "/tmp/$low.tar.gz" -C "/opt/$low" --strip-components=1 && rm "/tmp/$low.tar.gz"; \
      rm -rf "/opt/$low/${name}.Update"; \
      test -x "/opt/$low/$name"; \
    done; \
    python3 /usr/local/bin/dedupe /opt/sonarr /opt/radarr /opt/lidarr /opt/prowlarr

# qBittorrent (static qbittorrent-nox build, no GUI).
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    a=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    fetch-release userdocs/qbittorrent-nox-static "${QBITTORRENT_TAG}" "^${a}-qbittorrent-nox$" /usr/local/bin/qbittorrent-nox && \
    chmod +x /usr/local/bin/qbittorrent-nox

# Bazarr and SABnzbd, built in the python stage above.
COPY --from=python /opt/bazarr /opt/bazarr
COPY --from=python /opt/sabnzbd /opt/sabnzbd

# Tautulli (Plex statistics) ships its own libraries.
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    mkdir -p /opt/tautulli && \
    tag="${TAUTULLI_VERSION}"; [ "$tag" = latest ] && tag=$(curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} https://api.github.com/repos/Tautulli/Tautulli/releases/latest | jq -r .tag_name); \
    echo "Tautulli $tag" && \
    curl -fsSL "https://github.com/Tautulli/Tautulli/archive/refs/tags/${tag}.tar.gz" | tar -xz -C /opt/tautulli --strip-components=1

# Node.js for the UI, the wiring script and Seerr.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=seerr /app /opt/seerr

# GoatMediaStackarr itself: the UI (built from MediaHub), the setup scripts and the service definitions.
COPY ui /opt/goat/ui
COPY goat /opt/goat/bin
COPY rootfs /
RUN chmod +x /opt/goat/bin/*.sh /opt/goat/bin/*.js && \
    find /etc/s6-overlay/s6-rc.d \( -name run -o -name finish \) -exec chmod +x {} + && \
    echo "${VERSION}" > /opt/goat/VERSION

# /media and /downloads are not declared as volumes, so mapping one shared folder instead leaves no stray volumes behind.
VOLUME ["/config"]
# 2806 = GoatMediaStackarr, 8096 = Jellyfin, 5055 = Seerr's request page, 32400 = Plex (when turned on), 50413 = torrent port when the VPN is off
# (not 6881: trackers block 6881-6889; set TORRENT_PORT for another one).
EXPOSE 2806 8096 5055 32400 50413 50413/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS http://127.0.0.1:2806/api/health >/dev/null || exit 1

ENTRYPOINT ["/init"]
