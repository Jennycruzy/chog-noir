#!/usr/bin/env python3
"""Verify the running release survives edits to the main source and archive."""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

root = Path('/home/ubuntu/chog-noir-monitor')
release = Path('/home/ubuntu/chog-noir-release/current').resolve(strict=True)
source = root / 'apps/api/src/game.mts'
archive = root / 'runs/case-engine/archive.json'
snapshot = release / 'release-archive.json'
if release == root or source.samefile(release / 'apps/api/src/game.mts') or not snapshot.is_file():
    raise SystemExit('An isolated release and its archive snapshot are required')

if b'MAIN_SOURCE_ISOLATION_PROBE' in source.read_bytes() or not json.loads(archive.read_text()).get('cases'):
    raise SystemExit('Restore a previous isolation probe before starting another')

stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = root / 'runs/game-preview/isolation' / stamp
backup.mkdir(parents=True, mode=0o700)
saved = [(path, path.read_bytes(), stat.S_IMODE(path.stat().st_mode)) for path in (source, archive)]
for path, content, _ in saved:
    target = backup / path.name
    target.write_bytes(content)
    target.chmod(0o600)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def replace(path, content, mode):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.isolation-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def interrupted(_signal, _frame):
    raise SystemExit('Isolation check interrupted; restoring the main files')


for number in (signal.SIGINT, signal.SIGTERM):
    signal.signal(number, interrupted)

report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'FAIL',
          'release': str(release), 'backup': str(backup),
          'commit': subprocess.check_output(['git', '-C', str(release), 'rev-parse', 'HEAD'], text=True).strip()}
error = None
try:
    replace(source, saved[0][1] + b'\nthrow new Error("MAIN_SOURCE_ISOLATION_PROBE");\n', saved[0][2])
    replace(archive, b'{"releaseIsolationProbe":true}\n', saved[1][2])
    subprocess.run(['sudo', 'systemctl', 'restart', 'chog-noir-api.service'], check=True, timeout=120)
    deadline = time.monotonic() + 300
    while True:
        try:
            with urlopen('http://127.0.0.1:8311/health', timeout=15) as response:
                health = json.load(response)
            if health.get('gameAvailable') and health.get('cases', 0) >= 14:
                break
        except Exception:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('The release did not become healthy during the isolation probe')
        time.sleep(2)
    pid = subprocess.check_output(['systemctl', 'show', 'chog-noir-api.service', '-p', 'MainPID', '--value'], text=True).strip()
    if Path('/proc', pid, 'cwd').resolve() != release:
        raise RuntimeError('The API process is not running from the current release')
    report.update({'status': 'PASS', 'healthCases': health['cases'], 'mainSourceEditSurvived': True,
                   'sharedArchiveEditSurvived': True, 'snapshotHash': digest(snapshot.read_bytes())})
except BaseException as failure:
    error = failure
    report['error'] = str(failure)
finally:
    for path, content, mode in saved:
        replace(path, content, mode)
    report['restored'] = all(path.read_bytes() == content for path, content, _ in saved)
    if not report['restored']:
        report['status'] = 'FAIL'
    if error:
        subprocess.run(['sudo', 'systemctl', 'restart', 'chog-noir-api.service'], check=False, timeout=120)
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    output = Path.home() / 'chognoir-private/checks/release-isolation.json'
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
if error or report['status'] != 'PASS':
    raise SystemExit(1)
