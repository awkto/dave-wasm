# Deploying dave-wasm to box.dnsif.ca & pro.dnsif.ca

> **Live instances** (deployed): **https://dave.pro.dnsif.ca** and **https://dave.box.dnsif.ca**.
> Each runs `awkto/dave-wasm:latest` as a `docker run` container on `127.0.0.1:5027`, with full
> game data at `~/dave-data/{dave1,dave2,dave3}`, fronted by the host's nginx using its
> `*.<host>.dnsif.ca` wildcard cert. Auto-updates ride the host's existing Watchtower (pro watches
> all containers; box's `keen-watchtower` lists `dave-wasm` alongside the keen/zeliard games). The
> exact commands used:
>
> ```bash
> rsync -a deploy/data/  dave.<host-ssh>:dave-data/
> docker run -d --name dave-wasm --restart unless-stopped \
>   -p 127.0.0.1:5027:80 -v /home/altanc/dave-data:/data:ro awkto/dave-wasm:latest
> # nginx vhost dave.<host>.dnsif.ca -> 127.0.0.1:5027 (cert /etc/nginx/ssl/<host>.dnsif.ca.*)
> ```
>
> The generic compose-based recipe below is for a clean host from scratch.



Each host runs its own container + nginx reverse proxy. The full retail Dave 2/3 files live in a
mounted `/data`, so all three games run with no uploads and the bring-your-own UI is hidden.

```
            *.dnsif.ca wildcard DNS + wildcard TLS cert
                          │
        box.dnsif.ca ─────┤                   pro.dnsif.ca ─────┐
                          ▼                                     ▼
   ┌──────────────────────────────┐         ┌──────────────────────────────┐
   │ nginx :443 (host)            │         │ nginx :443 (host)            │
   │   proxy_pass 127.0.0.1:5024  │         │   proxy_pass 127.0.0.1:5024  │
   │ docker: awkto/dave-wasm      │         │ docker: awkto/dave-wasm      │
   │   /srv/dave-data:/data:ro    │         │   /srv/dave-data:/data:ro    │
   └──────────────────────────────┘         └──────────────────────────────┘
```

## 1. Stage the game files on each host

Put the **full** versions under `/srv/dave-data`, one subdir per game:

```
/srv/dave-data/
├── dave1/   DAVE.EXE  EGADAVE.DAV  DSCORES.DAV  CHKLIST.CPS
├── dave2/   1.EXE  *.DD2  (EGATILES, LEVEL01-08, S_*, TITLE1/2, INTRO, PROGPIC, STARPIC, CTLPANEL)
└── dave3/   DAVE.EXE  EGAGRAPH.DAV  GAMEMAPS.DAV  AUDIO.DAV  GFX_LIB.DAV  DIGSND.DAV  CONFIG.DAV  DAVE3.CHT
```

From your workstation (the files are staged in this repo's gitignored `deploy/data/`):

```bash
rsync -av deploy/data/  root@box.dnsif.ca:/srv/dave-data/
rsync -av deploy/data/  root@pro.dnsif.ca:/srv/dave-data/
```

## 2. Run the container

Copy `deploy/docker-compose.yml` to each host and bring it up:

```bash
docker compose up -d           # pulls awkto/dave-wasm:latest, mounts /srv/dave-data
docker logs dave-wasm          # should list: built dave1/dave2/dave3 + the manifest
```

(If CI hasn't pushed the image yet, switch the compose file to the local `build:` block, or
`docker build -t awkto/dave-wasm . && docker save | ...`.)

## 3. nginx reverse proxy + TLS

Install `deploy/nginx-dave.conf` on each host, setting `server_name` (`box.dnsif.ca` on box,
`pro.dnsif.ca` on pro) and pointing `ssl_certificate*` at the `*.dnsif.ca` wildcard cert:

```bash
cp deploy/nginx-dave.conf /etc/nginx/conf.d/dave-wasm.conf
# edit server_name + cert paths
nginx -t && systemctl reload nginx
```

Both names are single-label subdomains of `dnsif.ca`, so the `*.dnsif.ca` wildcard cert covers
them with no per-host certificate.

## 4. DNS

Ensure `box.dnsif.ca` and `pro.dnsif.ca` resolve to each host's public IP. If the `*.dnsif.ca`
wildcard record already points at the right place this is automatic; otherwise add explicit A/AAAA
records for the two names.

## Verify

```bash
curl -sk https://box.dnsif.ca/games/manifest.json
# {"serverMode":true,"games":[{"key":"dave1",...},{"key":"dave2",...},{"key":"dave3",...}]}
```

Open the site: it should show three one-click **Play** buttons and **no** upload card.

## Updating (automatic via Watchtower)

The compose file includes a **Watchtower** service that polls Docker Hub every 5 minutes and, when
a new `awkto/dave-wasm:latest` is pushed (by the release workflow), pulls it, recreates the
container, and prunes the old image. It's scoped by the `com.centurylinklabs.watchtower.enable`
label, so it only touches dave-wasm. Tag a new release → both hosts update themselves within ~5
minutes. (Bundles rebuild from `/data` on every container start, so no extra step.)

Manual update, if ever needed:

```bash
docker compose pull && docker compose up -d
```
