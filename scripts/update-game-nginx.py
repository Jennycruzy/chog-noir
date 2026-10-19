#!/usr/bin/env python3
"""Preserve the existing TLS host while enabling game routes and the event stream."""
from datetime import datetime, timezone
from pathlib import Path
import subprocess

site = Path('/etc/nginx/sites-enabled/chog-noir').resolve()
original = site.read_text()
if 'server_name chognoir.54-154-121-30.sslip.io;' not in original:
    raise SystemExit('Unexpected nginx host; no configuration changed')
old = 'location / { try_files $uri $uri/ =404; }'
new = 'location / { try_files $uri $uri/ /index.html; }'
if old not in original and new not in original:
    raise SystemExit('Unexpected root location; no configuration changed')
updated = original.replace(old, new)
if 'location = /api/events {' not in updated:
    updated = updated.replace('    location /api/ {', """    location = /api/events {
        proxy_pass http://127.0.0.1:8311;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
    location /api/ {""")
if 'PRIVATE_GAME_PATHS' not in updated:
    updated = updated.replace('    location /art/', """    # PRIVATE_GAME_PATHS: these paths must never fall through to the application.
    location ~ ^/(data|runs|packages|scripts|config|contracts|node_modules|chognoir-private)(/|$) { return 404; }
    location ~ /[.] { return 404; }
    location ~ [Ss][Pp][Ee][Cc].*[.]md$ { return 404; }
    location /art/""").replace('location /.well-known/acme-challenge/', 'location ^~ /.well-known/acme-challenge/')
backup = site.with_name(site.name + '.backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
# Backups stay outside sites-enabled, so nginx cannot load them as duplicate hosts.
backup = Path('/var/backups') / backup.name
backup.write_text(original)
backup.chmod(0o600)
site.write_text(updated)
try:
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    site.write_text(original)
    raise
print('Chog Noir routes updated; TLS directives and headers preserved. Backup:', backup)
