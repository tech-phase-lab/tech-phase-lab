"""Build or check the three-module payload carried by RESOLUTE_PROTECTED_JOB_*_B64.

Offline only: no network, no credentials, no Railway access. The module digest is
SHA256 of json.dumps({filename: source}, sort_keys=True, separators=(',', ':')),
the same digest the launcher prints in RESOLUTE_PROTECTED_BUNDLE_READY (it
reproduces the recorded fb7c4eda digest 8e9cae07... and 8daeaf3c digest 480e4935...).
The payload is base64(gzip(module JSON)) with a fixed gzip timestamp.

  python3 scripts/resolute/build-protected-bundle.py build --source scripts/resolute --out DIR
  python3 scripts/resolute/build-protected-bundle.py check --payload FILE --source DIR
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import sys

MODULES = ('backup.py', 'protection.py', 'protection_events.py')
MAX_PAYLOAD = 4 * 1024 * 1024


def module_json(source):
    mapping = {name: (Path(source) / name).read_text(encoding='utf-8') for name in MODULES}
    for name, text in mapping.items():
        compile(text, name, 'exec')
    return json.dumps(mapping, sort_keys=True, separators=(',', ':')).encode()


def digest(body):
    return hashlib.sha256(body).hexdigest()


def payload(body):
    return base64.b64encode(gzip.compress(body, compresslevel=9, mtime=0))


def decode(encoded):
    if len(encoded) > MAX_PAYLOAD:
        raise ValueError('payload too large')
    body = gzip.decompress(base64.b64decode(encoded, validate=True))
    mapping = json.loads(body)
    if not isinstance(mapping, dict) or set(mapping) != set(MODULES):
        raise ValueError('payload must contain exactly the three protected modules')
    return body, mapping


def build(source, out):
    body = module_json(source)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    encoded = payload(body)
    (out / 'modules.json').write_bytes(body)
    (out / 'payload.b64').write_bytes(encoded)
    report = {'modules_sha256': digest(body), 'payload_b64_bytes': len(encoded),
              'files': {name: digest((Path(source) / name).read_bytes()) for name in MODULES}}
    (out / 'bundle.json').write_text(json.dumps(report, indent=1, sort_keys=True) + '\n')
    return report


def check(payload_file, source):
    body, mapping = decode(Path(payload_file).read_bytes().strip())
    expected = module_json(source)
    if body != expected:
        differing = sorted(n for n in MODULES if mapping[n] != json.loads(expected)[n])
        raise ValueError('payload differs from source: ' + ', '.join(differing))
    return {'modules_sha256': digest(body), 'matches_source': True}


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('--source', default=str(Path(__file__).resolve().parent))
    b.add_argument('--out', required=True)
    c = sub.add_parser('check')
    c.add_argument('--payload', required=True)
    c.add_argument('--source', default=str(Path(__file__).resolve().parent))
    args = parser.parse_args(argv)
    result = build(args.source, args.out) if args.command == 'build' else check(args.payload, args.source)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, SyntaxError) as error:
        print(json.dumps({'event': 'RESOLUTE_BUNDLE_BUILD_FAILED', 'error': str(error)}), file=sys.stderr)
        raise SystemExit(1)
