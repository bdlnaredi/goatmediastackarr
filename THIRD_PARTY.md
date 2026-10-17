# Bundled software

GoatMediaStackarr bundles the following programs. Each is the official, unmodified release, downloaded from the project's own GitHub releases (Jellyfin from its official package repository) when the image is built. The exact versions are the `ARG` lines at the top of the [Dockerfile](Dockerfile). Source code for each is available at the links below.

| Program | What it does here | License | Source |
|---|---|---|---|
| Sonarr | TV shows | GPL-3.0 | https://github.com/Sonarr/Sonarr |
| Radarr | Movies | GPL-3.0 | https://github.com/Radarr/Radarr |
| Lidarr | Music | GPL-3.0 | https://github.com/Lidarr/Lidarr |
| Prowlarr | Indexers | GPL-3.0 | https://github.com/Prowlarr/Prowlarr |
| Bazarr | Subtitles | GPL-3.0 | https://github.com/morpheus65535/bazarr |
| Tautulli | Plex statistics | GPL-3.0 | https://github.com/Tautulli/Tautulli |
| qBittorrent (qbittorrent-nox, static build by userdocs) | Torrent downloads | GPL-2.0-or-later | https://github.com/qbittorrent/qBittorrent, https://github.com/userdocs/qbittorrent-nox-static |
| SABnzbd | Usenet downloads | GPL-2.0-or-later | https://github.com/sabnzbd/sabnzbd |
| Jellyfin (server, web, jellyfin-ffmpeg) | Media server and player | GPL-2.0 (ffmpeg: GPL-3.0) | https://github.com/jellyfin/jellyfin |
| Plex Media Server (optional, not included in the image) | Media server, downloaded from plex.tv on first start when turned on | Proprietary freeware, under Plex's own terms | https://www.plex.tv |
| Seerr | Requests | MIT | https://github.com/seerr-team/seerr |
| MediaHub | The interface GoatMediaStackarr is built from | GPL-3.0-or-later | https://github.com/bdlnaredi/mediahub |
| s6-overlay | Starts and watches every program | ISC | https://github.com/just-containers/s6-overlay |
| Node.js | Runs the interface, the setup scripts and Seerr | MIT | https://github.com/nodejs/node |
| Ubuntu 24.04 packages (WireGuard tools, OpenVPN, iptables, Python, par2, 7zip, unrar and others) | Base system | Various, see `/usr/share/doc/*/copyright` in the image | https://packages.ubuntu.com |

`unrar` is freeware, not open source. It may be redistributed free of charge, and SABnzbd uses it to unpack RAR archives.

The names and logos of these projects belong to their owners. GoatMediaStackarr is not affiliated with or endorsed by any of them.
