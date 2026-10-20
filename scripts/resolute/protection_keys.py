"""Offline age escrow and operator-local preparation. Never activates storage."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys

PURPOSE = 'resolute-online-protection-key-v1'
LIMIT = 16384


def fingerprint(key):
    if not isinstance(key, bytes) or len(key) != 32:
        raise ValueError('invalid protection key')
    return hashlib.sha256(PURPOSE.encode() + b'\0' + key).hexdigest()


def age(args, data):
    result = subprocess.run(['age', *args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=30, check=False)
    if result.returncode or len(result.stdout) > LIMIT:
        raise ValueError('age operation failed')
    return result.stdout


def recover(cipher, identity, pin, expected, run=age):
    if not isinstance(pin, str) or not re.fullmatch('[0-9a-f]{64}', pin):
        raise ValueError('independent capsule checksum required')
    if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
        raise ValueError('independent key fingerprint required')
    if not 1 <= len(cipher) <= LIMIT or not hmac.compare_digest(hashlib.sha256(cipher).hexdigest(), pin):
        raise ValueError('capsule checksum mismatch')
    raw = run(['-d', '-i', str(identity)], cipher)
    def unique(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError('duplicate capsule field')
            result[name] = value
        return result
    payload = json.loads(raw, object_pairs_hook=unique)
    if (not isinstance(payload, dict) or set(payload) != {'purpose', 'keyHex'}
            or payload['purpose'] != PURPOSE or not isinstance(payload['keyHex'], str)
            or not re.fullmatch('[0-9a-f]{64}', payload['keyHex'])):
        raise ValueError('invalid key capsule')
    key = bytes.fromhex(payload['keyHex'])
    if not hmac.compare_digest(fingerprint(key), expected):
        raise ValueError('recovered key mismatch')
    return key


def seal(key, recipient, identity, run=age):
    expected = fingerprint(key)
    if not isinstance(recipient, str) or not re.fullmatch('age1[0-9a-z]{58}', recipient):
        raise ValueError('native age recipient required')
    raw = json.dumps({'purpose': PURPOSE, 'keyHex': key.hex()}, separators=(',', ':')).encode()
    cipher = run(['-r', recipient], raw)
    pin = hashlib.sha256(cipher).hexdigest()
    if not hmac.compare_digest(recover(cipher, identity, pin, expected, run), key):
        raise ValueError('key round trip failed')
    return cipher, {'capsuleSha256': pin, 'keyFingerprint': expected}


def write_new(path, body):
    # O_EXCL also rejects existing symlinks; never truncate a previous escrow/key.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        os.unlink(path)
        raise


def keygen(args):
    result = subprocess.run(['age-keygen', *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=30, check=False)
    if result.returncode or not 1 <= len(result.stdout) <= LIMIT:
        raise ValueError('identity generation failed')
    return result.stdout


def prepare(directory, generate=keygen, run=age):
    # Native Windows chmod does not enforce private ACLs. Fail closed there.
    # Use a private POSIX filesystem (including WSL home, never /mnt/c).
    if os.name != 'posix':
        raise ValueError('private POSIX filesystem required')
    directory = Path(directory)
    parent = directory.parent.resolve(strict=True)
    info = parent.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('owner-only parent directory required')
    directory = parent / directory.name
    directory.mkdir(mode=0o700)  # Existing paths/symlinks are never reused.
    try:
        info = directory.stat()
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError('private permissions unavailable')
        identity = generate([])
        if not re.fullmatch(rb'(?:#[^\r\n]*\n)*AGE-SECRET-KEY-1[0-9A-Z]{58}\n?', identity):
            raise ValueError('invalid identity output')
        identity_path = directory / 'google-recovery-identity.txt'
        write_new(identity_path, identity)
        recipient = generate(['-y', str(identity_path)]).decode('ascii').strip()
        cipher, receipt = seal(secrets.token_bytes(32), recipient, identity_path, run)
        write_new(directory / 'evernote-recovery-capsule.age', cipher)
        write_new(directory / 'google-integrity-pins.json',
                  (json.dumps(receipt, sort_keys=True) + '\n').encode())
        # Written last: absent marker means this directory is incomplete.
        write_new(directory / 'local-preparation.json',
                  b'{"state":"locally-verified","remoteCustodyVerified":false,"activated":false}\n')
    except BaseException:
        # Only remove the directory we exclusively created, never an older set.
        shutil.rmtree(directory)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    initialize = sub.add_parser('prepare', help='Generate a fresh identity and sealed key locally; no activation')
    initialize.add_argument('--directory', required=True)
    create = sub.add_parser('seal')
    create.add_argument('--recipient', required=True)
    restore = sub.add_parser('recover')
    verify = sub.add_parser('verify', help='Authenticate a retrieved capsule without writing the key')
    for command in (restore, verify):
        command.add_argument('--capsule', required=True)
        command.add_argument('--capsule-sha256', required=True)
        command.add_argument('--key-fingerprint', required=True)
    for command in (create, restore, verify):
        command.add_argument('--identity', required=True)
    for command in (create, restore):
        command.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            prepare(args.directory)
            print('{"state":"locally-verified","remoteCustodyVerified":false,"activated":false}')
        elif args.command == 'seal':
            # Secret input is stdin, never an argument or environment dump.
            raw = sys.stdin.buffer.read(66)
            if not re.fullmatch(rb'[0-9a-f]{64}\n?', raw):
                raise ValueError('invalid key input')
            cipher, receipt = seal(bytes.fromhex(raw.decode().strip()), args.recipient, args.identity)
            write_new(args.output, cipher)
            print(json.dumps(receipt, sort_keys=True))
        else:
            with open(args.capsule, 'rb') as stream:
                cipher = stream.read(LIMIT + 1)
            key = recover(cipher, args.identity, args.capsule_sha256, args.key_fingerprint)
            if args.command == 'verify':
                # Verification never installs or serializes the recovered plaintext.
                print('{"state":"verified"}')
            else:
                write_new(args.output, key.hex().encode() + b'\n')
                print('{"state":"recovered"}')
    except Exception:
        # Exceptions and subprocess stderr may contain sensitive input/paths.
        print('RESOLUTE_KEY_ESCROW_FAILED', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
