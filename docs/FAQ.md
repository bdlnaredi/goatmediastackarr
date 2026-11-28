# GoatMediaStackarr FAQ

Answers to the questions that come up while installing GoatMediaStackarr, setting up its apps, and using it day to day. Start with **Logs** (Server menu → Logs → *Problems*) when something goes wrong: most problems are explained there in plain words.

**Jump to:** [Install and first start](#install-and-first-start) · [Signing in](#signing-in-and-accounts) · [Turning apps on and off](#turning-apps-on-and-off) · [Setting up each app](#setting-up-each-app) · [Plex and Tautulli from outside your home](#plex-and-tautulli-from-outside-your-home) · [Reaching it from outside](#reaching-goatmediastackarr-from-outside-your-home) · [The VPN](#the-vpn) · [Downloads](#downloads) · [Library, requests and Seerr](#library-requests-and-seerr) · [Watching](#watching-jellyfin-and-plex) · [The Android app](#the-android-app) · [Backups](#backups) · [Updates](#updates) · [Speed, CPU and storage](#speed-cpu-and-storage) · [Getting help](#getting-help)

---

## Install and first start

**How do I install it on Unraid?**
Add the container from the template in [`unraid/goatmediastackarr.xml`](../unraid/goatmediastackarr.xml). Set **App data** (on a cache drive or SSD), **Media** and **Downloads**, switch on the apps you want (the **App:** fields), and press **Apply**. Then open `http://YOUR-SERVER:2806` and make your admin account. The [README](../README.md#install-on-unraid) has the full list.

**Not on Unraid?**
Use [`docker-compose.yml`](../docker-compose.yml). Keep `cap_add: NET_ADMIN` and the `/dev/net/tun` device if you want the VPN.

**The first start is taking a long time. Is it stuck?**
Probably not. On its first start every app sets itself up, gets its own keys and passwords, and is connected to the others. Give it 5–10 minutes (longer for Plex, which is downloaded from plex.tv on first start). The Stack page shows each step as it happens. If one shows *Problem*, the message next to it says why.

**The page says "Connection refused" or doesn't open.**
- Wait a minute after starting: GoatMediaStackarr's page comes up after its first start step.
- Check that port **2806** is mapped in the template and isn't used by another container.
- Look at the container's log in Unraid (Docker tab → the container's icon → Logs) for a line starting with `[goat]` that says what went wrong.

**What does the setup checklist on the Stack page want from me?**
Two things the stack can't do by itself: **indexers** (the sites it searches, added on the Indexers page or in Prowlarr) and, if you use Usenet, your **news server** (the Usenet page). Everything else is connected for you. Press *I'm done* when you've worked through it.

**How much space does it need?**
The image is about 2.4 GB. App data grows with your library: Jellyfin's and Plex's artwork and databases can reach many GB. Jellyfin won't start with less than 2 GB free in App data, and FlareSolverr needs about 1.5 GB more when it's on. Keep App data on a cache drive or SSD, not the array.

**Should Media and Downloads be separate shares?**
They can be, but then every finished download is *copied* into the library, and a torrent that keeps seeding uses its space twice. To have downloads moved instantly (hardlinked) instead, map one share, for example `/data` → `/mnt/user/data`, and set **Media folder in container** to `/data/media` and **Downloads folder in container** to `/data/downloads`.

**An app says "Permission denied" on its own folder.**
This happens after App data was copied or restored as root. Restart the container: every start hands each app's folders back to the user it runs as (`PUID`/`PGID`, 99/100 on Unraid).

---

## Signing in and accounts

**What's the login for GoatMediaStackarr?**
The admin account you made on the first visit. There is no default password.

**What are the logins for Jellyfin, qBittorrent, ruTorrent and Deluge?**
Stack page → **Logins made for you**. Each was made on the first start. Change them there rather than inside the apps: GoatMediaStackarr then passes the new password to Sonarr, Radarr and Prowlarr too, so nothing breaks.

**What about Sonarr's, Radarr's or Tautulli's own login?**
You don't need one. Open them from the Stack page (or at `/engines/sonarr`, `/engines/tautulli`…), signed in to GoatMediaStackarr as an admin. Tautulli's own login page is skipped for you.

**I forgot my password.**
On the sign-in page press **Forgot password?**: a reset link is emailed to you, if alerts by email are set up (Settings → Alerts) and your profile has an email address. Another admin can also set a new password for you under Settings → Users. If you're the only admin and email isn't set up, there's no way back in from the page, so set up email or make a second admin while you can.

**How do I give family and friends their own sign-in?**
Settings → **Users**: make a profile for each person and choose what they can do (request, approve, see downloads…). People on your Plex server can also use **Sign in with Plex**, turned on under Settings → Users → *Sign in with Plex*.

**Can I use a passkey or two-step codes?**
Yes: Settings → **Account** has passkeys (fingerprint, face, Windows Hello, a security key) and two-step sign-in.

---

## Turning apps on and off

**How do I turn an app on or off?**
In Unraid, edit the container: each app has its own **App:** switch (for example *App: Plex*, *App: cross-seed*). Set it to **true** or **false** and press **Apply**. Outside Unraid, set `GOAT_APP_<NAME>=true` or `false` (`GOAT_APP_PLEX`, `GOAT_APP_CROSS_SEED`…).

**I changed a switch, but nothing happened.**
You probably still have a list of your own in **Apps to run (list)** (advanced view). That list decides while it holds one, so that updating the template can't turn your apps on or off by itself. Set the switches to match what you run, empty the list, and press **Apply**. The container's log shows `[goat] Apps to run: …` at every start, so you can check what it picked.

**Which apps are on unless I turn them off?**
Sonarr, Radarr, Lidarr, Prowlarr, Bazarr, qBittorrent, SABnzbd, Jellyfin, Seerr and File Browser. Plex, Tautulli, FlareSolverr, ruTorrent, Deluge, Unpackerr, cross-seed and autobrr start off.

**I turned an app off. Is its data gone?**
No. Its folder in App data stays, and so do its login and keys. Turn it back on and it carries on where it was.

**Why does it make a Jellyfin password if I don't run Jellyfin?**
It doesn't any more: logins are only made for the apps you run. One made earlier is kept (hidden), so turning the app back on still works with its old settings.

---

## Setting up each app

Almost everything is connected for you on the first start. These are the few things each app needs from you.

**Sonarr, Radarr and Lidarr**
Nothing to set up. Their library folders, download clients (qBittorrent, SABnzbd, and ruTorrent and Deluge when on) and indexers (from Prowlarr) are added for you. Adjust quality profiles in their own pages (Stack page → Open), or bring yours over with **Bring in your current setup** on the Stack page.

**Prowlarr (indexers)**
Add your indexer sites on the **Indexers** page, or in Prowlarr itself. Prowlarr hands them to Sonarr, Radarr and Lidarr by itself. For sites behind Cloudflare, see FlareSolverr below.

**qBittorrent**
Ready to use. Its login is on the Stack page. Finished torrents go to `downloads/torrents/complete`. With the VPN on, qBittorrent uses it, and if your VPN forwards a port, that port is set in qBittorrent for you.

**SABnzbd (Usenet)**
Add your news server on the **Usenet** page (address, port, SSL, username, password, connections), then press **Test**. Without one, SABnzbd has nothing to download from.

**Bazarr (subtitles)**
It's connected to Sonarr and Radarr. Pick your languages and subtitle providers in Bazarr's own page (Stack page → Open Bazarr), or on the **Subtitles** page.

**Jellyfin**
Its Movies, TV Shows and Music libraries are made for you. Sign in to the Jellyfin apps on your TV and phone at `http://YOUR-SERVER:8096` with the **Jellyfin admin** login from the Stack page, or make users for your family in Jellyfin's dashboard. For hardware transcoding, see [Watching](#watching-jellyfin-and-plex).

**Seerr (requests)**
It signs in through Jellyfin (or Plex, when Jellyfin is off) and sends requests to Sonarr and Radarr. Family and friends use its own page on port **5055**, or ask inside GoatMediaStackarr. With both Jellyfin and Plex running, set **Seerr media server** to `plex` in the template to use Plex; this is decided on Seerr's first setup.

**Plex (built in)**
1. Set *App: Plex* to true and map port **32400** (Plex port, advanced view).
2. Get a claim code at [plex.tv/claim](https://plex.tv/claim) while signed in to Plex.
3. Paste it on the Stack page under **Plex** and press **Link** within 4 minutes (or put it in **Plex claim code** in the template before starting).

The Movies, TV Shows and Music libraries are made for you. Plex isn't shipped in the image (it isn't open source): it's downloaded from plex.tv on first start, and updated at every start unless **Update Plex** is false.

**Your own Plex (not in the container)**
Add it under Settings → Apps. For Seerr to use it while Jellyfin is off, set **Your Plex address** and **Your Plex token** in the template.

**Tautulli (Plex statistics)**
Turn on *App: Tautulli* (it needs Plex, the built-in one or yours). It's connected to Plex for you. Open it from the Stack page; there's no separate login. Its statistics also feed GoatMediaStackarr's **Watch stats** and **Year in review**.

**FlareSolverr**
For indexer sites that show Cloudflare's "checking your browser" page. Turn on *App: FlareSolverr* (x86 only). It's added to Prowlarr for you with the tag `flaresolverr`. Give that tag to the indexers that need it, in Prowlarr: Indexers → edit → Tags.

**ruTorrent and Deluge**
Turn on *App: ruTorrent* and/or *App: Deluge* and map their ports (8090 and 8112). Their logins are on the Stack page. They're added to Sonarr, Radarr, Lidarr and Prowlarr as download clients after qBittorrent, used only when qBittorrent isn't available. Change the priorities in their Download Clients settings to make one the main client.

**Unpackerr**
Turn on *App: Unpackerr*. It unpacks `.rar`, `.zip` and `.7z` downloads so Sonarr, Radarr and Lidarr can import them, then removes the unpacked copy (the archive keeps seeding). It's connected for you and has no page of its own. For Usenet too, set `UNPACKERR_PROTOCOLS=torrent,usenet` (SABnzbd unpacks its own by default).

**cross-seed**
Turn on *App: cross-seed* (it needs qBittorrent). It finds the torrents you already have on your other trackers and seeds them there too, with no extra download or space. It uses every torrent tracker in Prowlarr. **After adding a tracker to Prowlarr, restart cross-seed** on the Stack page. On a torrent in Downloads, **Find on other trackers** searches it right away.

**autobrr**
Turn on *App: autobrr*. Open it from the Stack page (at `/engines/autobrr`, admins only) and make its account. Then add your trackers' IRC details and filters, and add qBittorrent as its download client: host `127.0.0.1`, port `8080`, with the qBittorrent login from the Stack page.

**File Browser**
On unless *App: File Browser* is false. Stack page → File Browser (admins only) shows your media and downloads folders in the browser.

**Apps I already run elsewhere (a seedbox, another container)**
Add them under Settings → Apps: Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Jackett, qBittorrent, ruTorrent, Deluge, SABnzbd, Plex, Jellyfin, Seerr, Tautulli, Bazarr and Unraid itself. They appear in GoatMediaStackarr like the built-in ones.

**How do I connect phone apps such as nzb360 or LunaSea?**
- **Sonarr, Radarr and the others:** use GoatMediaStackarr's address plus `/engines/sonarr` (or `/engines/radarr`, `/engines/prowlarr`…), with that app's API key from its Settings → General.
- **Tautulli:** use `/engines/tautulli` with Tautulli's API key (Tautulli → Settings → Web Interface).
- **qBittorrent:** use `/engines/qbittorrent` with the qBittorrent login from the Stack page.

Use port 2806 (or your outside address), not the apps' own ports: those only listen inside the container.

---

## Plex and Tautulli from outside your home

This is for when Plex (and Tautulli) run **inside** GoatMediaStackarr and you want to watch Plex away from home.

**Why doesn't it just work?**
Inside Docker, Plex only sees the container's own address (`172.17.x.x`) and tells plex.tv that one, which nothing outside can reach. GoatMediaStackarr fixes the *home* side for you. It gives Plex your server's real address (*Custom server access URLs*, for example `http://192.168.1.10:32400`) and your home network (*LAN Networks*, for example `192.168.1.0/24`), taken from the address you open GoatMediaStackarr with. The *outside* side needs the steps below.

**Before you start: you need Plex Pass for remote video.**
Since April 2025, playing your own videos on Plex away from home needs a Plex Pass on the server owner's account (which covers everyone you share with), or a Remote Watch Pass on the viewer's account. Music in Plexamp and photos are still free. See [Plex's requirements](https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/).

**The steps (direct connection, best quality):**

1. **Map port 32400** in the template: *Plex port* `32400` → `32400` (TCP), with *App: Plex* set to true.
2. **Forward the port on your router**: TCP **32400** from outside to your Unraid server's local address, port 32400. Give the server a fixed local address (a DHCP reservation) so the forward keeps working.
3. **Turn on Remote Access in Plex**: open Plex (`http://YOUR-SERVER:32400/web`) → Settings → **Remote Access** → **Enable Remote Access**. Tick **Manually specify public port**, enter `32400`, and press **Apply**. It should say *Fully accessible outside your network*.
4. **Check Settings → Network in Plex** (*Show Advanced*):
   - **Custom server access URLs**: keep the one GoatMediaStackarr filled in (`http://192.168.x.x:32400`). If you have a domain or a fixed public address, add it after a comma, for example `http://YOUR-PUBLIC-IP:32400` or `https://plex.example.com:443` when a reverse proxy sits in front.
   - **LAN Networks**: your home network, for example `192.168.1.0/24` (filled in for you). This keeps phones and TVs at home counted as local, so they don't need Plex Pass and aren't limited like remote streams.
   - **Secure connections**: *Preferred*.
   - **Remote streams allowed per user** and **Internet upload speed** (under Remote Access): set to what your connection can carry.
5. **Keep Plex off the VPN.** By default only qBittorrent, SABnzbd and Prowlarr use the VPN, and Plex isn't among them. If you added Plex to **Apps through VPN**, take it out: the kill switch blocks incoming connections, so remote access can't work.
6. **Test from outside**: on your phone with Wi-Fi off, open the Plex app. The server should play with *Direct* or *Local* in the stream info, not *Indirect*.

**Remote Access stays red ("Not available outside your network").**
- **CGNAT**: many home connections, including some fibre plans in India, share one public address between customers, so a port forward can't reach you. Your router's WAN address starting with `100.64.`–`100.127.`, or not matching [whatismyip](https://www.whatismyip.com), is the sign. Ask your provider for a public IP (sometimes a small add-on), or use Tailscale (below).
- **Double router**: if your ISP's router sits in front of your own, forward the port on both, or put the ISP router in bridge mode.
- **Port 32400 used elsewhere**: another Plex container on the same server needs a different outside port. Map, say, `32401` → `32400` and enter `32401` as the public port in Plex.

**Without opening a port: Tailscale.**
Install the Tailscale plugin on Unraid and the Tailscale app on your phone. Then, in Plex → Settings → Network → **Custom server access URLs**, add `http://<your Unraid's Tailscale address>:32400`, for example `http://100.101.102.103:32400`. While your phone's Tailscale is on, Plex connects directly, with no port forward and no CGNAT problem. Note that Plex may count Tailscale connections as remote, so Plex Pass rules still apply. Everyone you share with needs Tailscale too, so this suits your own devices best.

**Can I put Plex behind a Cloudflare Tunnel?**
It works, but Cloudflare's terms don't allow streaming lots of video through a free tunnel, and it adds delay. Use a port forward or Tailscale for Plex.

**What about Tautulli from outside?**
Tautulli doesn't need a port of its own. It's reached through GoatMediaStackarr: wherever GoatMediaStackarr opens from outside (Tailscale, a Cloudflare Tunnel, a reverse proxy), Tautulli opens at that address plus `/engines/tautulli`, for admins. For nzb360 or another Tautulli app, use `https://YOUR-GOAT-ADDRESS/engines/tautulli` with Tautulli's API key. Port 8181 isn't the way in: it only listens inside the container.

**Should the Plex address on the Stack page be filled in?**
Stack page → **From outside your home** → *Plex* is the address GoatMediaStackarr's **Open in Plex** buttons use when you're away. For example `https://app.plex.tv`, which always finds your server through your Plex account, or your own `https://plex.example.com`. When it's a hostname of your own, it's also added to Plex's Custom server access URLs at the next start, unless you've changed that field in Plex yourself.

---

## Reaching GoatMediaStackarr from outside your home

**What's the easiest way?**
**Tailscale** (the Unraid plugin, and the Tailscale app on your phone and laptop). Open `http://<your Unraid's Tailscale name>:2806`, and use the same address in the Android app. Jellyfin (8096), Seerr (5055) and Plex (32400) work at the same name with their ports. Nothing is opened to the internet.

**I want a normal web address (goat.example.com).**
Use a **Cloudflare Tunnel** (or a reverse proxy such as Nginx Proxy Manager or SWAG):
1. Point `goat.example.com` at `http://YOUR-SERVER:2806`.
2. Give Jellyfin and Seerr their own hostnames (`jellyfin.example.com` → port 8096, `requests.example.com` → port 5055).
3. Enter those hostnames on the Stack page under **From outside your home**, so the Open buttons use them away from home.

Sonarr, Radarr and the other apps need nothing extra: they open through GoatMediaStackarr's own address.

**The Android app works at home but not outside.**
In the app, Settings → **Server** has two addresses: the one at home (used on your Wi-Fi) and the one outside (used everywhere else). Put your Tailscale or tunnel address in the outside one.

---

## The VPN

**How do I turn the VPN on?**
- **Private Internet Access (PIA):** on the Stack page choose PIA, enter your PIA username (`p1234567`) and password, pick a region or *Fastest*, and press **Save and apply**.
- **Any other provider:** upload its WireGuard `.conf` (or OpenVPN `.ovpn`) file on the Stack page, or put it in `appdata/goatmediastackarr/vpn/`, and turn the VPN on.

**Which apps use it?**
qBittorrent, SABnzbd and Prowlarr by default (**Apps through VPN**). ruTorrent, Deluge, cross-seed and autobrr follow qBittorrent, and FlareSolverr follows Prowlarr. Jellyfin, Plex, Seerr, Sonarr, Radarr and the web pages keep your normal connection.

**How do I know it works?**
Stack page → **Leak test** compares the VPN apps' address with your server's own. They must differ.

**The VPN keeps saying "Connecting…".**
Open Logs → **VPN** and pick *Problems*. It names the step that failed: signing in (wrong PIA username or password), reaching the region's server (pick another region), or the tunnel check (a wrong or old `.conf` file: download a fresh one from your provider).

**When the VPN is down, do the downloads use my home connection?**
No. The kill switch cuts the VPN apps off from the internet before they start, and whenever the tunnel is down. They can still talk to the other apps, so Sonarr always reaches qBittorrent.

**Downloads are slow with the VPN on.**
Pick a server near you, use WireGuard rather than OpenVPN, and turn on port forwarding if your provider has it: `VPN_PORT_FORWARD=pia` for PIA, or `natpmp` for ProtonVPN and similar. More peers can then connect to you.

**Indexer sites are slow or blocked through the VPN.**
Prowlarr goes through the VPN by default, which also gets around providers that block those sites. If one site is slow that way, take Prowlarr out of **Apps through VPN**.

---

## Downloads

**I added a .torrent on qBittorrent's page, but nothing appeared.**
Fixed in v1.0.39. Update the container, then delete any entry in qBittorrent whose name is a long string of letters and numbers (left by earlier tries), and add the file again. Adding from GoatMediaStackarr's own **Add** always worked.

**A download finished, but Sonarr or Radarr didn't import it.**
Open Logs → *Problems*, or Sonarr's or Radarr's Activity → Queue, for the reason. The common ones:
- **It's a .rar archive**: turn on Unpackerr.
- **"Path does not exist or is not accessible"**: the download client and Sonarr see different folders. Keep the default folders (`/downloads/...`), or set both *folder in container* settings when using one share.
- **"Permission denied"**: restart the container (see [Install](#install-and-first-start)).
- **It doesn't match**: the release was named differently; use **Manual import** in Sonarr or Radarr.

**Downloads are stuck at 0% or "stalled".**
The torrent has no seeds right now, or qBittorrent can't reach peers. With the VPN on, check the Leak test and Logs → VPN. Without the VPN, map the **Torrent port** (50413, TCP and UDP) and forward it on your router.

**A tracker says the client isn't allowed.**
Some private trackers only allow certain versions of qBittorrent, ruTorrent or Deluge. Check your tracker's client list. The weekly rebuild always brings the newest release, which most trackers allow.

**How do I limit download speeds at certain hours?**
Settings → **Download rules** has a speed schedule, and slowing downloads while someone is streaming. The Downloads page has qBittorrent's own limits and limits per category.

**How do I remove downloads, and what do the choices do?**
On the Downloads page, open a download (or tick several, then **Remove** in the bar that appears). The dialog asks:
- **Delete the downloaded files**: off keeps them on the disk. What Sonarr or Radarr already imported into the library always stays.
- **Also remove from Sonarr / Radarr**: takes it off their queue, so they stop waiting for it.
- **Blocklist this release** and **Search for another**: Sonarr or Radarr won't pick that release again and look for a different one.

Tick one box, then Shift-click another to select every download in between. Each part can be turned on or off, with the boxes ticked to start with, in Settings → **Download rules** → *Removing downloads*.

**Can finished downloads be removed by themselves?**
Yes, once Sonarr or Radarr has imported them and they're done seeding: Settings → **Download rules** → *Remove after the tracker's seeding goal*. Give private trackers their ratio or days. For the rest, tick *Also when the download app has finished seeding it*, which uses qBittorrent's own share limits. Nothing is removed while it's still waiting to be imported.

**cross-seed isn't finding anything.**
It searches only the torrent trackers in Prowlarr: Usenet indexers and public sites don't count. Restart cross-seed on the Stack page after adding a tracker. Logs → cross-seed says *Failed to reach* or *rate limit* when a tracker paused it for a while; restarting starts every tracker afresh.

---

## Library, requests and Seerr

**Seerr says it "needs a media server".**
Turn on Jellyfin, turn on the built-in Plex, or add your Plex under Settings → Apps (with **Your Plex address** and **Your Plex token** in the template).

**There are no posters in Discover or Seerr, and the log shows `[TMDB] … ECONNRESET`.**
Some internet providers block TMDB, where the posters come from. Leave **DNS for the apps** empty: GoatMediaStackarr then adds public DNS servers when TMDB can't be looked up. Or set it to `1.1.1.1,8.8.8.8`.

**A request was approved, but nothing downloads.**
Check the **Wanted** page: the title is there when no release was found yet. It usually means no indexers (add some), no match for the quality profile, or not released yet. Press **Search** on its page to try now.

**Can requests be approved by themselves?**
Yes. Settings → **Limits** → *Request rules* approves requests that fit a rule (for example movies rated 7+ under 10 GB). Profiles can also be allowed to approve their own requests (Settings → Users).

**Can I limit how much someone streams or keeps?**
Settings → **Limits**: a monthly streaming limit for everyone or per person, and request limits per profile.

**"Unable to get queue from Sonarr/Radarr" after restoring a backup.**
The restored app has its old API key. The next container start puts the right one back everywhere.

---

## Watching (Jellyfin and Plex)

**Playback stutters or the CPU is at 100% while watching.**
The video is being converted (transcoded) on the CPU. Use the graphics chip instead:
1. In the template, set **Graphics card** to `/dev/dri`, for Intel or AMD chips with built-in graphics.
2. Turn on hardware transcoding: in Jellyfin's Dashboard → Playback → Transcoding (pick *Intel QuickSync* or *VAAPI*), or in Plex's Settings → Transcoder → *Use hardware acceleration when available* (needs Plex Pass).

Or set your TV and phone apps to *Original* quality, so nothing has to be converted at home.

**TVs at home connect to Plex as "Indirect" or "Remote".**
Plex doesn't know your home network. Check Plex → Settings → Network → **LAN Networks** (for example `192.168.1.0/24`) and **Custom server access URLs** (`http://YOUR-SERVER:32400`). GoatMediaStackarr fills both in from the address you open it with. Open GoatMediaStackarr once by the server's local IP address (not `localhost` or a domain) and restart the container if they're empty.

**Jellyfin doesn't start: "not enough free space".**
Jellyfin needs 2 GB free in App data. Free up space on that drive.

**New episodes don't show in Jellyfin or Plex.**
Sonarr and Radarr tell both to scan when something is imported. If one was missed, press *Scan library* in Jellyfin or Plex. Settings → Backup → **Maintenance window** can run the library scans at night.

---

## The Android app

**Where do I get it?**
Download `goatmediastackarr.apk` from the [latest release](https://github.com/bdlnaredi/goatmediastackarr/releases/latest) on your phone and open it. You'll need to allow installs from your browser the first time. It needs Android 8 or newer.

**What address do I enter?**
The one you use in the browser, for example `192.168.1.10:2806` at home, or your Tailscale or tunnel address. Settings → Server can hold both, and the app picks the right one on its own.

**There's no APK in the newest release.**
The app is only built and attached when all its tests pass. If one failed, the release has no APK yet. Install the app from the release before it until the next version is out; the app tells you when a newer one is ready.

**Notifications don't arrive.**
Allow notifications for GoatMediaStackarr in Android's settings, and set its battery use to *Unrestricted*. Some phones stop background apps otherwise. Check which notifications you get under Settings → Notifications in the app.

**How do I get to Settings and the other pages?**
Tap **☰** at the top left of Home, Discover, Library or Downloads (or swipe in from the left edge). The side menu has your stack's apps first, then every other page, with Settings at the bottom.

---

## Backups

**What should I back up?**
The whole App data folder (`appdata/goatmediastackarr`): every app's settings and database are in it. Use the **Appdata Backup** plugin on Unraid, and GoatMediaStackarr's own backups below.

**What do GoatMediaStackarr's backups cover?**
Settings → **Backup** has two kinds:
- **GoatMediaStackarr's own settings** (accounts, profiles, requests, alerts): *Download backup* makes a passphrase-locked file, and *Automatic backups* makes a daily copy in its data folder.
- **The whole stack** (*Back up the whole stack*, every app's settings and databases): on a schedule, with **Back up now**, and automatically before an app updates.

Each kind keeps the number of copies you set and deletes older ones.

**How do I copy backups to Google Drive?**
Settings → Backup → *Copy backups to the cloud* → **Google Drive**:
- **One tap**, if you set *Google client ID* and *Google client secret* in the template (from your own Google app: the field's description links to Google Cloud and says what to set): Google's page opens, you allow access, and you're sent back connected.
- **Without them**: sign in on Google's page, then copy the address of the page you land on (it won't open, that's expected) and paste it into GoatMediaStackarr.

Then press **Back up to the cloud now** to check: it copies in the background, and the panel shows *Last copy* or the error.

**"Request had insufficient authentication scopes" with Google Drive.**
The connection was made without Drive access. Press **Disconnect**, connect Google Drive again, and allow access.

**"permission denied … stack-before-update" when copying to the cloud.**
Fixed: update the container. Existing backups are made readable at the next start.

**How do I restore?**
- **GoatMediaStackarr's own settings:** Settings → Backup → **Restore** with the file and its passphrase.
- **The whole stack:** Settings → Backup → *Back up the whole stack* → pick a backup → **Put back** (a copy of the current state is made first).
- **Everything:** stop the container and put back the App data folder from your Unraid backup.

---

## Updates

**How do I update?**
Unraid's Docker tab shows *update ready* when a new image is out. Press **Update** (or let the Auto Update plugin do it). Back up App data first: a newer app can change its database so an older one can't read it.

**How often are there updates?**
New versions whenever something is added or fixed, plus a **weekly rebuild** every Monday with the newest release of every app, published only after every check passes.

**What changed?**
**What's new** in the menu (and in the app) lists every version's changes. It opens by itself once after an update. The same list is the [CHANGELOG](../CHANGELOG.md).

**An app broke after an update.**
Look at the Stack page: each app's version and what changed is listed. The stack backup made just before the update can bring that app's settings back (Settings → Backup → *Back up the whole stack* → **Put back**). Then [tell us](#getting-help) which version broke.

---

## Speed, CPU and storage

**GoatMediaStackarr uses a lot of CPU.**
Almost all of it is the apps inside, not GoatMediaStackarr itself. The biggest savings:
1. **Turn off apps you don't use** (their App: switches): two media servers (Jellyfin and Plex) means two sets of library scans, and FlareSolverr runs a whole browser.
2. **Plex's background jobs**: in Plex → Settings → Library, set video preview thumbnails, intro and credit markers, and loudness analysis to *never* or *as a scheduled task*.
3. **Hardware transcoding**: see [Watching](#watching-jellyfin-and-plex).
4. **Cap the container**: in Unraid's advanced view, add `--cpus=4` (or your number) to **Extra Parameters**, or use CPU pinning.
5. **Slower RSS checks**: in Sonarr and Radarr, raise Settings → Indexers → *RSS Sync Interval* to 30–60 minutes.

**App data keeps growing.**
Mostly artwork and thumbnails from Jellyfin and Plex, and logs. Turn off Plex's video preview thumbnails (they take the most), and keep fewer stack backups (Settings → Backup → *Back up the whole stack*).

---

## Getting help

**Where do I look first?**
**Logs** (Server menu) → *Problems* shows the lines that went wrong, from every app, in plain words. Logs → VPN, → cross-seed and the others show one app each.

**How do I report a problem?**
[Open an issue](https://github.com/bdlnaredi/goatmediastackarr/issues) with what you did, what happened, and the log lines that look wrong. **Save** on the Logs page gives you a file to attach. Or send it from **Suggestions** in the menu.

**Is there a demo?**
Running the web page with `DEMO=1` shows it with pretend apps. Nothing is saved and nothing real is touched.
