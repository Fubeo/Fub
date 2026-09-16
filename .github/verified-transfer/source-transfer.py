"""One-time, hash-checked source transport. Creates objects, NEVER moves refs.

The manifest is plain JSON containing only line replacements and file hashes.
No eval, shell interpolation, compressed payloads, or production credentials.
Only the three Git object POST endpoints used below receive the temporary token.
This helper stays on an isolated branch and is not part of the candidate tree.
"""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import urllib.request

BASE = '86e4f28f7144e8575e31145550ad3a46340abe6c'
TREE = '13d98529689fdb2a82d813614b44cc5309f85868'
DIGESTS = [
    'b82221368abd0bde2b93934b102d90b5348bc921beb68f8a69a8039d2c249a12',
    '04ef91cde8763b50258a4e6e12aff481c5440a383249d06bcaf183829c65f32d',
    '5f50367e4da9899d8dcb508e82f5d9b43c5126d354cfe356f49af488a3b6fbbf',
    '862ec66a4576fc72ac5a74929149e056a8969db04ee70127626356c4c9ad92cc',
]
BASELINES = [f'{scene}-{light}.png' for scene in ('palette', 'empty', 'graph') for light in ('dark', 'light')]
root = Path(sys.argv[2]).resolve()
reports = Path(sys.argv[3]).resolve()
reports.mkdir(parents=True, exist_ok=True)
manifest = []
for i, expected in enumerate(DIGESTS):
    raw = Path(__file__).with_name(f'fub-transfer-{i}.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected, f'manifest digest {i}'
    manifest.extend(json.loads(raw))
assert len(manifest) == 31 and len({e['path'] for e in manifest}) == 31
for entry in manifest:
    path = PurePosixPath(entry['path'])
    assert not path.is_absolute() and '..' not in path.parts and '.git' not in path.parts

def digest(data):
    return hashlib.sha256(data).hexdigest()

def source_bytes():
    result = {}
    for entry in manifest:
        data = (root / entry['path']).read_bytes()
        assert digest(data) == entry['after'], f"source changed: {entry['path']}"
        result[entry['path']] = data
    return result

def post(kind, value):
    assert kind in ('blobs', 'trees', 'commits')
    request = urllib.request.Request(
        f'https://api.github.com/repos/Fubeo/Fub/git/{kind}',
        data=json.dumps(value).encode(), method='POST',
        headers={'Authorization': f"Bearer {os.environ['GH_OBJECT_TOKEN']}",
                 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)

def commit(files, base_tree, parent, message):
    entries = []
    for name, data in sorted(files.items()):
        blob = post('blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        expected = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
        assert blob['sha'] == expected, name
        entries.append({'path': name, 'mode': '100644', 'type': 'blob', 'sha': expected})
    tree = post('trees', {'base_tree': base_tree, 'tree': entries})['sha']
    sha = post('commits', {'message': message, 'tree': tree, 'parents': [parent]})['sha']
    return {'sha': sha, 'tree': tree, 'parent': parent, 'files': {n:digest(d) for n,d in files.items()}}

mode = sys.argv[1]
if mode == 'apply':
    assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == BASE
    pending = {}
    for entry in manifest:
        target = root / entry['path']
        assert target.exists() == entry['exists'], str(target)
        origin = root / (entry['copy_from'] or entry['path'])
        raw = origin.read_bytes() if origin.exists() else b''
        assert digest(raw) == entry['before'], f"preimage mismatch: {entry['path']}"
        lines = raw.decode().splitlines(keepends=True)
        previous = 0
        for start, end, replacement in entry['changes']:
            assert previous <= start <= end <= len(lines)
            previous = end
        for start, end, replacement in reversed(entry['changes']):
            lines[start:end] = [replacement]
        result = ''.join(lines).encode()
        assert digest(result) == entry['after'], f"postimage mismatch: {entry['path']}"
        pending[target] = result
    for target, data in pending.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    source_bytes()
    print('31 source files match the locally tested hashes; concurrent files retained.')
elif mode == 'source':
    result = commit(source_bytes(), TREE, BASE, 'fix(sheet): riusa i servizi e verifica le superfici nel browser')
    (reports / 'source.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
elif mode == 'baseline':
    source_bytes()
    source = json.loads((reports / 'source.json').read_text())
    files = {f'apps/client/bench/baseline/{name}': (reports / 'baselines' / name).read_bytes() for name in BASELINES}
    result = commit(files, source['tree'], source['sha'], 'test(client): allinea sei baseline alle superfici verificate su Linux')
    (reports / 'candidate.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
else:
    raise ValueError(mode)
