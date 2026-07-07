# Deploying LEXTOWN-01

Target shape: one small Ubuntu box (Lightsail nano is plenty — the server is a
static file host + JSON relay, no database), Caddy for TLS, systemd to keep it up.

## One-time box setup (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt install -y nodejs npm caddy
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

## Notes

- The client auto-connects `wss://` same-origin, so no client config is needed.
- No persistence: restarting the service just empties the world for a moment.
- Logs: `journalctl -u lextown -f` (join/leave lines + cheat-strike warnings).
