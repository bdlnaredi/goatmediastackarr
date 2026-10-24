# GoatMediaStackarr: one container that runs a whole media stack.
# Engines are the official open-source releases, fetched at build time and run side by side under s6-overlay.

ARG NODE_VERSION=22

# ---------- Seerr is built from source on glibc so it runs on the Ubuntu base below ----------
FROM node:${NODE_VERSION}-bookworm AS seerr
# "latest" takes the newest Seerr release each time the image is built (the weekly rebuild too); a tag pins one.
ARG SEERR_VERSION=latest
# VERSION changes on every build, so this stage is built again instead of reused from the cache (else "latest" would stick).
ARG VERSION=dev
ENV CYPRESS_INSTALL_BINARY=0 CI=true
WORKDIR /app
# COMMIT_TAG has to be set while building: Seerr bakes it into its page and compares it with committag.json (the
# server's copy). If they differ, the page shows "Seerr Updated, please reload" on every visit.
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    tag="${SEERR_VERSION}"; \
    if [ "$tag" = latest ]; then tag=$(curl -fsSL --retry 4 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} https://api.github.com/repos/seerr-team/seerr/releases/latest | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).tag_name'); fi; \
    echo "Seerr $tag" && \
    corepack enable && \
    git clone --depth 1 --branch "$tag" https://github.com/seerr-team/seerr /app && \
    export COMMIT_TAG="$tag" && \
    pnpm install --frozen-lockfile && \
    pnpm build && \
    rm -rf .next/cache && \
    pnpm prune --prod && \
    # Source maps, tests and docs are not needed to run it.
    find . -name '*.map' -not -path './.git/*' -delete && rm -rf .git cypress docs && \
    echo "{\"commitTag\": \"$tag\"}" > committag.json && \
    # Stop the build if the page and the server would disagree about the version.
    grep -rqsF "$tag" .next/static .next/required-server-files.json || { echo "Seerr version tag missing from its page build"; exit 1; }

# ---------- Bazarr and SABnzbd with their Python packages, built with compilers the final image never carries ----------
FROM ubuntu:24.04 AS python
ARG TARGETARCH
ARG BAZARR_VERSION=latest
ARG SABNZBD_VERSION=latest
# Changes on every build, so Bazarr and SABnzbd are fetched again instead of reused from the cache.
ARG VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive
COPY goat/fetch-release.sh /usr/local/bin/fetch-release
RUN chmod +x /usr/local/bin/fetch-release && apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl jq unzip python3 python3-venv python3-dev build-essential libxml2-dev libxslt1-dev
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    fetch-release morpheus65535/bazarr "${BAZARR_VERSION}" '^bazarr\.zip$' /tmp/bazarr.zip /tmp/v-bazarr && \
    mkdir -p /opt/bazarr && unzip -q /tmp/bazarr.zip -d /opt/bazarr && rm /tmp/bazarr.zip && mv /tmp/v-bazarr /opt/bazarr/.goat-version && \
    python3 -m venv /opt/bazarr/venv && \
    /opt/bazarr/venv/bin/pip install --no-cache-dir -r /opt/bazarr/requirements.txt
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    fetch-release sabnzbd/sabnzbd "${SABNZBD_VERSION}" '^SABnzbd-.*-(src|source)\.tar\.gz$' /tmp/sab.tar.gz /tmp/v-sab && \
    mkdir -p /opt/sabnzbd && tar -xzf /tmp/sab.tar.gz -C /opt/sabnzbd --strip-components=1 && rm /tmp/sab.tar.gz && mv /tmp/v-sab /opt/sabnzbd/.goat-version && \
    python3 -m venv /opt/sabnzbd/venv && \
    /opt/sabnzbd/venv/bin/pip install --no-cache-dir -r /opt/sabnzbd/requirements.txt && \
    (cd /opt/sabnzbd && /opt/sabnzbd/venv/bin/python tools/make_mo.py >/dev/null 2>&1 || true)
# Deluge, the official release from PyPI (published by the Deluge team). It uses Ubuntu's libtorrent bindings
# (python3-libtorrent, installed in the final image), so its environment can see the system's Python packages.
ARG DELUGE_VERSION=latest
RUN python3 -m venv --system-site-packages /opt/deluge && \
    # Deluge still imports pkg_resources, which Python 3.12 environments no longer include; setuptools 81 drops it.
    # pyOpenSSL 24.3 removed X509Req, which Deluge 2.2 uses to make its certificate ("Unable to start deluged").
    /opt/deluge/bin/pip install --no-cache-dir "setuptools<81" "pyopenssl<24.3" "deluge$([ "$DELUGE_VERSION" = latest ] || echo "==${DELUGE_VERSION#deluge-}")" && \
    /opt/deluge/bin/python -W ignore -c 'import pkg_resources, deluge.pluginmanagerbase; from OpenSSL.crypto import X509Req' && \
    /opt/deluge/bin/pip show deluge | sed -n 's/^Version: //p' > /opt/deluge/.goat-version && cat /opt/deluge/.goat-version
# Compiled caches are rebuilt when needed.
RUN find /opt/bazarr /opt/sabnzbd /opt/deluge -name __pycache__ -prune -exec rm -rf {} +

# ---------- rTorrent (the downloader behind ruTorrent), built from its own source: github.com/rakshasa ----------
FROM ubuntu:24.04 AS rtorrent
ARG RTORRENT_VERSION=latest
# Changes on every build, so "latest" is looked up again instead of reused from the cache.
ARG VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq git build-essential autoconf autoconf-archive automake libtool pkg-config \
      libcurl4-openssl-dev libssl-dev zlib1g-dev libncurses-dev
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    set -e; tag="${RTORRENT_VERSION}"; \
    [ "$tag" = latest ] && tag=$(curl -fsSL --retry 4 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} https://api.github.com/repos/rakshasa/rtorrent/releases/latest | jq -r .tag_name); \
    echo "rTorrent $tag"; \
    git clone -q --depth 1 --branch "$tag" https://github.com/rakshasa/libtorrent /src/libtorrent; \
    git clone -q --depth 1 --branch "$tag" https://github.com/rakshasa/rtorrent /src/rtorrent; \
    cd /src/libtorrent && autoreconf -fi && ./configure --prefix=/opt/rtorrent --disable-debug && make -j"$(nproc)" && make install; \
    cd /src/rtorrent && autoreconf -fi && \
      PKG_CONFIG_PATH=/opt/rtorrent/lib/pkgconfig LDFLAGS="-Wl,-rpath,/opt/rtorrent/lib" ./configure --prefix=/opt/rtorrent --with-xmlrpc-tinyxml2 --disable-debug && \
      make -j"$(nproc)" && make install; \
    rm -rf /opt/rtorrent/include /opt/rtorrent/lib/pkgconfig /opt/rtorrent/lib/*.la /opt/rtorrent/lib/*.a /opt/rtorrent/share; \
    strip /opt/rtorrent/bin/rtorrent /opt/rtorrent/lib/libtorrent.so.*; \
    /opt/rtorrent/bin/rtorrent -h >/dev/null 2>&1 || true; \
    echo "${tag#v}" > /opt/rtorrent/.goat-version

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
      par2 7zip unrar \
      php8.3-cli php8.3-mbstring php8.3-xml php8.3-curl php8.3-sqlite3 php8.3-zip unzip python3-libtorrent libncursesw6 && \
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
      fetch-release "$name/$name" "$tag" "^${name}\..*linux(-core)?-${a}\.tar\.gz$" "/tmp/$low.tar.gz" "/opt/goat/versions/$low"; \
      mkdir -p "/opt/$low" && tar -xzf "/tmp/$low.tar.gz" -C "/opt/$low" --strip-components=1 && rm "/tmp/$low.tar.gz"; \
      rm -rf "/opt/$low/${name}.Update"; \
      test -x "/opt/$low/$name"; \
    done; \
    python3 /usr/local/bin/dedupe /opt/sonarr /opt/radarr /opt/lidarr /opt/prowlarr

# qBittorrent (static qbittorrent-nox build, no GUI).
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    a=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    fetch-release userdocs/qbittorrent-nox-static "${QBITTORRENT_TAG}" "^${a}-qbittorrent-nox$" /usr/local/bin/qbittorrent-nox /opt/goat/versions/qbittorrent && \
    chmod +x /usr/local/bin/qbittorrent-nox

# Bazarr and SABnzbd, built in the python stage above.
COPY --from=python /opt/bazarr /opt/bazarr
COPY --from=python /opt/sabnzbd /opt/sabnzbd

# Tautulli (Plex statistics) ships its own libraries.
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    mkdir -p /opt/tautulli && \
    tag="${TAUTULLI_VERSION}"; [ "$tag" = latest ] && tag=$(curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} https://api.github.com/repos/Tautulli/Tautulli/releases/latest | jq -r .tag_name); \
    echo "Tautulli $tag" && mkdir -p /opt/goat/versions && echo "$tag" > /opt/goat/versions/tautulli && \
    curl -fsSL "https://github.com/Tautulli/Tautulli/archive/refs/tags/${tag}.tar.gz" | tar -xz -C /opt/tautulli --strip-components=1

# ruTorrent (optional, port 8090): its own release from github.com/Novik/ruTorrent, served by PHP's web server.
# rTorrent and Deluge (optional, port 8112) come from the build stages above.
ARG RUTORRENT_VERSION=latest
COPY --from=rtorrent /opt/rtorrent /opt/rtorrent
COPY --from=python /opt/deluge /opt/deluge
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    set -e; tag="${RUTORRENT_VERSION}"; \
    [ "$tag" = latest ] && tag=$(curl -fsSL --retry 4 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} https://api.github.com/repos/Novik/ruTorrent/releases/latest | jq -r .tag_name); \
    echo "ruTorrent $tag"; mkdir -p /opt/rutorrent /opt/goat/versions; \
    curl -fsSL --retry 4 "https://github.com/Novik/ruTorrent/archive/refs/tags/${tag}.tar.gz" | tar -xz -C /opt/rutorrent --strip-components=1; \
    rm -rf /opt/rutorrent/tests /opt/rutorrent/.github; test -f /opt/rutorrent/plugins/httprpc/action.php; \
    # Plugins that need programs this image does not carry (Cloudflare bypass in Python, dumptorrent, sox) are
    # turned off, so ruTorrent does not warn about them at every start.
    printf '\n[_cloudflare]\nenabled = no\n\n[dump]\nenabled = no\n\n[spectrogram]\nenabled = no\n' >> /opt/rutorrent/conf/plugins.ini; \
    # Wait up to 30 seconds (not 10) for rTorrent before saying it timed out: it is slow right after a start.
    sed -i -E 's/("webui\.reqtimeout":[[:space:]]*)10000/\130000/' /opt/rutorrent/js/webui.js; grep -q '"webui.reqtimeout":[[:space:]]*30000' /opt/rutorrent/js/webui.js; \
    echo "${tag#v}" > /opt/goat/versions/rutorrent; \
    test -x /opt/rtorrent/bin/rtorrent && /opt/rtorrent/bin/rtorrent -h | head -n 1; \
    test -x /opt/deluge/bin/deluged && /opt/deluge/bin/python -c 'import libtorrent, deluge; print("Deluge with libtorrent", libtorrent.__version__)'

# Node.js for the UI, the wiring script and Seerr.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=seerr /app /opt/seerr

# GoatMediaStackarr itself: the UI (built from MediaHub), the setup scripts and the service definitions.
COPY ui /opt/goat/ui
COPY goat /opt/goat/bin
COPY rootfs /
RUN chmod +x /opt/goat/bin/*.sh /opt/goat/bin/*.js && \
    find /etc/s6-overlay/s6-rc.d \( -name run -o -name finish \) -exec chmod +x {} + && \
    echo "${VERSION}" > /opt/goat/VERSION && \
    # Which version of each app this image carries. GoatMediaStackarr compares it with the last one it ran, to say
    # what an update changed.
    v=/opt/goat/versions && cp /opt/bazarr/.goat-version $v/bazarr && cp /opt/sabnzbd/.goat-version $v/sabnzbd && \
    cp /opt/rtorrent/.goat-version $v/rtorrent && cp /opt/deluge/.goat-version $v/deluge && \
    jq -r .commitTag /opt/seerr/committag.json > $v/seerr && \
    dpkg-query -W -f='${Version}' jellyfin-server | sed 's/[+-].*//' > $v/jellyfin && \
    (cd $v && for f in *; do printf '%s\t%s\n' "$f" "$(tr -d '\r\n' < "$f")"; done) | \
      jq -R -s --arg built "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg goat "${VERSION}" \
        '{built: $built, goat: $goat, apps: (split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | sub("^(v|release-)"; "") | sub("_v[0-9.]+$"; ""))}) | add)}' > /opt/goat/versions.json && \
    cat /opt/goat/versions.json

# /media and /downloads are not declared as volumes, so mapping one shared folder instead leaves no stray volumes behind.
VOLUME ["/config"]
# 2806 = GoatMediaStackarr, 8096 = Jellyfin, 5055 = Seerr's request page, 32400 = Plex (when turned on), 50413 = torrent port when the VPN is off
# (not 6881: trackers block 6881-6889; set TORRENT_PORT for another one). When turned on: 8090 = ruTorrent, 8112 = Deluge,
# with 50414 and 50415 as their torrent ports.
EXPOSE 2806 8096 5055 32400 50413 50413/udp 8090 8112 50414 50414/udp 50415 50415/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS http://127.0.0.1:2806/api/health >/dev/null || exit 1

ENTRYPOINT ["/init"]
