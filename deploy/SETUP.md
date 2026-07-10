# Deploying LEXTOWN-01

**Production (2026-07-07): https://playlextown.com** — Lightsail nano
`playlextown` (us-east-1a, key `~/.ssh/lextown.pem`, user `ubuntu`), domain
registered via Route53 (auto-renew on, privacy on), zone `Z0193083291ALXGNIZKM6`.
No static IP (account quota full) — the public IP survives reboots but changes
on stop/start; if that happens, update the A records for `@` and `www`.

Target shape: one small Ubuntu box (Lightsail nano is plenty — the server is a
static file host + JSON relay, no database), Caddy for TLS, systemd to keep it up.

## One-time box setup (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt install -y nodejs npm caddy

# 1 GB swap + no fwupd (both applied to prod 2026-07-09). The nano has
# 414 MB RAM and no swap by default; Ubuntu's fwupd daemon woke up, ate
# ~140 MB, the kernel OOM'd, and the whole box (Caddy + sshd included)
# locked up until an API reboot. Swap absorbs spikes; a headless VM
# needs no firmware-update daemon.
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo systemctl mask --now fwupd.service fwupd-refresh.timer
sudo git clone https://github.com/paul-codes-1/lextown /opt/lextown
cd /opt/lextown && sudo npm ci --omit=dev
sudo cp deploy/lextown.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lextown
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open ports 80 + 443 in the instance firewall (Lightsail networking tab).
Port 8080 stays closed to the world — only Caddy talks to it.

## DNS

Add `lextown.lexingtonky.news` as an A record pointing at the box's static IP.
Start DNS-only (grey cloud) so Caddy's Let's Encrypt HTTP challenge works;
optionally flip to Cloudflare-proxied afterward (CF proxies WebSockets fine —
if you do, switch Caddy to a CF origin cert or keep LE via DNS challenge).

## Updating

```bash
cd /opt/lextown && sudo git pull && sudo systemctl restart lextown
```

## Ambient NPCs (optional)

`bots/npcs.mjs` runs a handful of preset-line chatter characters (no AI calls)
that connect to the relay as ordinary clients so the city feels inhabited when
few humans are online. They degrade gracefully — if the process dies the game
is unaffected, you just get fewer chatters. They are excluded from the human
join/peak stats and from cheat heuristics but stay visible in-world and appear
in the `/admin/stats` roster tagged `npc:1`.

The `npc` tag is a shared secret. **systemd gotcha:** `Environment=` lines do
not expand `${VAR}` from another unit's drop-in, so the same literal token must
be written into BOTH the NPC unit's drop-in and the server's env drop-in. The
NPC process appends it to the WS URL as `?npc=<token>` itself; the server reads
`NPC_TOKEN` from its own environment and compares.

```bash
# 1. install the NPC unit
sudo cp deploy/lextown-npcs.service /etc/systemd/system/

# 2. give the SERVER the token (same file as ADMIN_TOKEN, or a new drop-in)
sudo mkdir -p /etc/systemd/system/lextown.service.d
printf '[Service]\nEnvironment=NPC_TOKEN=%s\n' "$(openssl rand -hex 16)" \
  | sudo tee /etc/systemd/system/lextown.service.d/npc.conf
# copy the value it printed — it must match the NPC drop-in below

# 3. give the NPC process the SAME token
sudo mkdir -p /etc/systemd/system/lextown-npcs.service.d
sudo tee /etc/systemd/system/lextown-npcs.service.d/npc.conf <<'EOF'
[Service]
Environment=NPC_TOKEN=PASTE_THE_SAME_TOKEN_HERE
EOF

# 4. reload + start both (restart the server so it picks up NPC_TOKEN)
sudo systemctl daemon-reload
sudo systemctl restart lextown
sudo systemctl enable --now lextown-npcs
```

Without a token the NPCs still connect and chat — they just count as ordinary
players in the stats. `journalctl -u lextown-npcs -f` shows their join lines.

## Notes

- The client auto-connects `wss://` same-origin, so no client config is needed.
- No persistence: restarting the service just empties the world for a moment.
- Logs: `journalctl -u lextown -f` (join/leave lines + cheat-strike warnings).
