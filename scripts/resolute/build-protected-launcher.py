"""Build the RESOLUTE protected job launcher deterministically from repository sources.

Offline only: no network, no credentials, no Railway access. Reads the three
protected modules at --commit (git show), serialises them exactly as
build-protected-bundle.py does (same modules_sha256), embeds that JSON text in
protected-launcher.py and writes:

  launcher.py      the launcher that RESOLUTE_PROTECTED_JOB_*_B64 decodes to
  launcher.py.gz   gzip of launcher.py (level 9, mtime 0, no file name)
  launcher.b64     base64 of launcher.py.gz on one line, no trailing newline (the variable value)
  launcher.json    commit, mode, modules_sha256, launcher_sha256 and sizes
  start-command.txt (only with --variable) the service start command for that variable

  python3 scripts/resolute/build-protected-launcher.py --commit SHA --mode restore \
      --variable RESOLUTE_PROTECTED_JOB_V4_B64 --out DIR

--source DIR reads the modules from a directory instead of git (tests only); the
commit is then only a label.
"""
import argparse
import ast
import base64
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('resolute_bundle', HERE / 'build-protected-bundle.py')
bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bundle)

TEMPLATE = HERE / 'protected-launcher.py'
MODES = ('restore', 'backup')
CONSTANTS = ('COMMIT', 'EXPECTED_MODE', 'MODULES_SHA256', 'PAYLOAD')
START_COMMAND = ('/bin/bash -c \'printf "%s" "${variable}" | base64 -d | gunzip > /tmp/resolute_backup.py; '
                 'timeout 900 /bin/bash -c "apt-get update -qq && apt-get install -y -qq python3 '
                 'python3-boto3 python3-cryptography age >/dev/null && python3 /tmp/resolute_backup.py"\'')


def git_modules(commit, repo):
    mapping = {}
    for name in bundle.MODULES:
        out = subprocess.run(['git', '-C', str(repo), 'show', f'{commit}:scripts/resolute/{name}'],
                             capture_output=True, check=True)
        mapping[name] = out.stdout.decode('utf-8')
    return mapping


def dir_modules(source):
    return {name: (Path(source) / name).read_text(encoding='utf-8') for name in bundle.MODULES}


def literal(value):
    # Module JSON escapes every quote and newline, so a raw triple-quoted string holds it
    # without doubling backslashes (better gzip ratio). fill() checks the round trip.
    if value.startswith('{') and value.endswith('}') and '"""' not in value and '\n' not in value:
        return 'r"""' + value + '"""'
    return repr(value)


def fill(template, values):
    text = template
    for name in CONSTANTS:
        line = f"{name} = ''\n"
        if text.count(line) != 1:
            raise ValueError(f'template must contain exactly one empty {name}')
        text = text.replace(line, f'{name} = {literal(values[name])}\n')
    tree = ast.parse(text)
    found = {node.targets[0].id: node.value.value for node in tree.body
             if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
             and node.targets[0].id in CONSTANTS}
    if found != values:
        raise ValueError('filled constants do not round-trip')
    compile(text, 'protected-launcher.py', 'exec')
    return text


def build(commit, mode, out, source=None, repo=None, variable=None):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('commit must be a full 40-character SHA')
    if mode not in MODES:
        raise ValueError('mode must be restore or backup')
    if variable is not None and not re.fullmatch(r'RESOLUTE_PROTECTED_JOB_[A-Z0-9_]+_B64', variable):
        raise ValueError('invalid variable name')
    mapping = dir_modules(source) if source else git_modules(commit, repo or HERE.parent.parent)
    for name, text in mapping.items():
        compile(text, name, 'exec')
    body = json.dumps(mapping, sort_keys=True, separators=(',', ':')).encode()
    values = {'COMMIT': commit, 'EXPECTED_MODE': mode, 'MODULES_SHA256': bundle.digest(body),
              'PAYLOAD': body.decode('ascii')}
    launcher = fill(TEMPLATE.read_text(encoding='utf-8'), values).encode('utf-8')
    compressed = gzip.compress(launcher, compresslevel=9, mtime=0)
    if gzip.decompress(compressed) != launcher:
        raise ValueError('gzip round trip failed')
    encoded = base64.b64encode(compressed)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'launcher.py').write_bytes(launcher)
    (out / 'launcher.py.gz').write_bytes(compressed)
    (out / 'launcher.b64').write_bytes(encoded)
    report = {'commit': commit, 'mode': mode, 'modules_sha256': values['MODULES_SHA256'],
              'launcher_sha256': hashlib.sha256(launcher).hexdigest(),
              'launcher_bytes': len(launcher), 'launcher_gzip_bytes': len(compressed),
              'launcher_b64_bytes': len(encoded), 'value_sha256': hashlib.sha256(encoded).hexdigest(),
              'files': {name: hashlib.sha256(text.encode('utf-8')).hexdigest()
                        for name, text in sorted(mapping.items())}}
    if variable:
        report['variable'] = variable
        (out / 'start-command.txt').write_text(START_COMMAND.replace('${variable}', '$' + variable))
    (out / 'launcher.json').write_text(json.dumps(report, indent=1, sort_keys=True) + '\n')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--mode', required=True, choices=MODES)
    parser.add_argument('--out', required=True)
    parser.add_argument('--variable')
    parser.add_argument('--source')
    parser.add_argument('--repo')
    args = parser.parse_args(argv)
    print(json.dumps(build(args.commit, args.mode, args.out, args.source, args.repo, args.variable),
                     sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, SyntaxError, subprocess.CalledProcessError) as error:
        print(json.dumps({'event': 'RESOLUTE_LAUNCHER_BUILD_FAILED', 'error': str(error)}), file=sys.stderr)
        raise SystemExit(1)
