import base64
import json
import subprocess
from pathlib import Path

ROOT = Path('/home/ubuntu/faithfit-platform')
REPO = 'GoldstarOrbital/faithfit-platform'
FILES = [
    'docs/analysis-notes.md',
    'docs/functioning-faith-strava-roadmap.md',
    'webapp/public/styles.css',
    'webapp/public/index.html',
    'webapp/public/sw.js',
    'webapp/public/app.js',
]

def gh(args, payload=None):
    cmd = ['gh', 'api', *args]
    result = subprocess.run(cmd, cwd=ROOT, input=(json.dumps(payload) if payload is not None else None), text=True, capture_output=True, check=True)
    return json.loads(result.stdout) if result.stdout.strip() else None

def main():
    ref = gh([f'repos/{REPO}/git/ref/heads/main'])
    parent = ref['object']['sha']
    parent_commit = gh([f'repos/{REPO}/git/commits/{parent}'])
    entries = []
    for rel in FILES:
        content = (ROOT / rel).read_bytes()
        blob = gh([f'repos/{REPO}/git/blobs', '-X', 'POST', '-H', 'Accept: application/vnd.github+json', '--input', '-'], {
            'content': base64.b64encode(content).decode('ascii'),
            'encoding': 'base64',
        })
        entries.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    tree = gh([f'repos/{REPO}/git/trees', '-X', 'POST', '-H', 'Accept: application/vnd.github+json', '--input', '-'], {
        'base_tree': parent_commit['tree']['sha'],
        'tree': entries,
    })
    commit = gh([f'repos/{REPO}/git/commits', '-X', 'POST', '-H', 'Accept: application/vnd.github+json', '--input', '-'], {
        'message': 'Polish responsive shell and resilient demo flow',
        'tree': tree['sha'],
        'parents': [parent],
    })
    updated = gh([f'repos/{REPO}/git/refs/heads/main', '-X', 'PATCH', '-H', 'Accept: application/vnd.github+json', '--input', '-'], {
        'sha': commit['sha'],
        'force': False,
    })
    print(json.dumps({'parent': parent, 'remote_commit': commit['sha'], 'ref': updated['object']['sha']}, indent=2))

if __name__ == '__main__':
    main()
