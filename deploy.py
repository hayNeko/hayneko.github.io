#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-command updater for the Hayneko static site.

Target : http://SERVER_ADDRESS/   (Arch Linux + nginx)
Webroot: /usr/share/nginx/html

What it does
------------
1. packs the current working tree (archive/, prism-1.30.0/, .git/ ... excluded)
2. uploads over SFTP and verifies SHA256 on the server
3. extracts into a fresh directory and fixes ownership / permissions
4. backs up the live webroot to /var/backups/nginx-html-<ts>.tar.gz
5. swaps directories (previous version stays at html.prev)
6. runs nginx -t + systemctl reload nginx
7. verifies key URLs over HTTP; any failure rolls back automatically

Usage
-----
    python deploy.py                 # interactive
    python deploy.py --dry-run       # pack only, show what would be sent
    python deploy.py --rollback      # restore html.prev
    python deploy.py --yes           # skip the confirmation prompt

Password: DEPLOY_PASS environment variable, or an interactive prompt.
Requires: Python 3.8+ and paramiko (python -m pip install paramiko).
"""

import argparse
import getpass
import hashlib
import os
import shlex
import shutil
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_HOST = "SERVER_ADDRESS"
DEFAULT_USER = "hayneko"
DEFAULT_PORT = 22
DEFAULT_ROOT = "/usr/share/nginx/html"
REMOTE_TAR = "/tmp/hayneko-site.tar.gz"

# Everything at the repository root is deployed except these names.
EXCLUDE_DIRS = {".git", ".mnemon", ".verify", ".vscode", "archive",
                "prism-1.30.0", "node_modules", "__pycache__"}
ROOT_EXCLUDE_FILES = {"README.md", "serve.cmd", "deploy.py", "deploy.cmd",
                     "colors.txt", ".gitignore"}
JUNK_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXCLUDE_PREFIXES = (".tmp-", "_t_")
EXCLUDE_DIR_PREFIXES = (".tmp-", "_t_")

KEY_PATHS = ["/", "/index.html", "/styles/tokens.css", "/scripts/app.js",
             "/i18n/en.json", "/views/home.html", "/medias/pictures/miku.JPG",
             "/manifest.json", "/50x.html"]


# --------------------------------------------------------------------------- #
# local side
# --------------------------------------------------------------------------- #
def collect_files(root):
    """Return (relative file list, skipped directory list)."""
    files, skipped = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        kept = []
        for d in dirnames:
            if d in EXCLUDE_DIRS or d.startswith(EXCLUDE_DIR_PREFIXES):
                skipped.append(os.path.normpath(os.path.join(rel_dir, d)).replace(os.sep, "/"))
            else:
                kept.append(d)
        dirnames[:] = kept
        for fn in filenames:
            if fn in JUNK_FILES or fn.startswith(EXCLUDE_PREFIXES):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
            if "/" not in rel and fn in ROOT_EXCLUDE_FILES:
                continue
            full = os.path.join(dirpath, fn)
            if os.path.islink(full) or not os.path.isfile(full):
                continue
            files.append(rel)
    files.sort()
    return files, skipped


def build_archive(files, root, out_path):
    """Create a deterministic tar.gz; returns its sha256."""
    stamp = int(time.time())
    with tarfile.open(out_path, "w:gz", format=tarfile.PAX_FORMAT, compresslevel=6) as tar:
        for rel in files:
            full = os.path.join(root, rel)
            st = os.stat(full)
            info = tarfile.TarInfo(rel)
            info.size = st.st_size
            info.mtime = stamp
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            with open(full, "rb") as fh:
                tar.addfile(info, fh)
    return sha256_file(out_path)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_size(num):
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return "{:.1f} {}".format(num, unit)
        num /= 1024.0


# --------------------------------------------------------------------------- #
# remote side
# --------------------------------------------------------------------------- #
def connect(args, password):
    import paramiko
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(args.host, port=args.port, username=args.user,
                   password=password, timeout=15, banner_timeout=20,
                   auth_timeout=20, allow_agent=False, look_for_keys=False)
    return client


def run_remote(client, command, password=None, timeout=900):
    chan = client.get_transport().open_session()
    chan.settimeout(timeout)
    chan.exec_command(command)
    if password:
        chan.sendall((password + "\n").encode("utf-8"))
    chan.shutdown_write()
    chunks = []
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536))
            continue
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536))
            continue
        if chan.exit_status_ready():
            break
        time.sleep(0.05)
    while chan.recv_ready():
        chunks.append(chan.recv(65536))
    while chan.recv_stderr_ready():
        chunks.append(chan.recv_stderr(65536))
    return chan.recv_exit_status(), b"".join(chunks).decode("utf-8", "replace")


def upload_file(client, local, remote, size):
    sftp = client.open_sftp()
    started = time.time()
    state = {"next_pct": 10}

    def progress(done, total):
        pct = (100.0 * done / total) if total else 100.0
        if done == total or pct >= state["next_pct"]:
            state["next_pct"] = int(pct) // 10 * 10 + 10
            sys.stdout.write("    upload {:3d}%  {:6.1f} / {:6.1f} MB\n".format(
                int(pct), done / 1048576.0, total / 1048576.0))
            sys.stdout.flush()

    sftp.put(local, remote, callback=progress, confirm=True)
    sftp.close()
    print("    upload finished in {:.1f}s".format(time.time() - started))


def upload_script(client, text, remote):
    sftp = client.open_sftp()
    with sftp.file(remote, "wb") as fh:
        fh.write(text.encode("utf-8"))
    sftp.chmod(remote, 0o700)
    sftp.close()


DEFS = """set -euo pipefail

ROOT=@ROOT@
NEW="$ROOT.new"
PREV="$ROOT.prev"
TAR=@TAR@
EXPECTED=@SHA@
TS=$(date +%Y%m%d-%H%M%S)
SWAPPED=0

rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$SWAPPED" -eq 1 ]; then
    echo "!! deploy failed (rc=$rc); rolling back"
    rm -rf "$ROOT.failed"
    mv "$ROOT" "$ROOT.failed" 2>/dev/null || true
    mv "$PREV" "$ROOT" 2>/dev/null || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    echo "ROLLED_BACK"
  fi
}
trap rollback EXIT

echo "[1/7] verify upload"
ACTUAL=$(sha256sum "$TAR" | cut -d' ' -f1)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "HASH_MISMATCH expected=$EXPECTED actual=$ACTUAL"
  exit 11
fi
echo "    sha256 ok"

echo "[2/7] extract to $NEW"
rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf "$TAR" -C "$NEW"
if [ -f "$ROOT/50x.html" ]; then
  cp -a "$ROOT/50x.html" "$NEW/50x.html"
fi

echo "[3/7] ownership and modes"
chown -R root:root "$NEW"
find "$NEW" -type d -exec chmod 755 {} +
find "$NEW" -type f -exec chmod 644 {} +
FILE_COUNT=$(find "$NEW" -type f | wc -l)

echo "[4/7] backup live site"
mkdir -p /var/backups
if [ -d "$ROOT" ]; then
  tar -czf "/var/backups/nginx-html-$TS.tar.gz" -C "$ROOT" .
  ls -1t /var/backups/nginx-html-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
fi

echo "[5/7] switch directories"
rm -rf "$ROOT.failed"
rm -rf "$PREV"
if [ -d "$ROOT" ]; then
  mv "$ROOT" "$PREV"
fi
SWAPPED=1
mv "$NEW" "$ROOT"

echo "[6/7] nginx test and reload"
nginx -t
systemctl reload nginx

echo "[7/7] verify over HTTP"
FAILED=0
for p in / /index.html /styles/tokens.css /scripts/app.js /i18n/en.json /views/home.html /medias/pictures/miku.JPG /manifest.json /50x.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1$p") || code=000
  printf '    %-40s %s\\n' "$p" "$code"
  [ "$code" = "200" ] || FAILED=1
done
if [ "$FAILED" -ne 0 ]; then
  echo "HTTP_CHECK_FAILED"
  exit 12
fi

echo "DEPLOYED_SHA $(sha256sum "$ROOT/index.html" | cut -d' ' -f1)"
echo "DEPLOYED_FILES $FILE_COUNT"
echo "PREV_DIR $PREV"
echo "BACKUP /var/backups/nginx-html-$TS.tar.gz"
echo "DEPLOY_OK"
"""

ROLLBACK_SCRIPT = """set -euo pipefail

ROOT=@ROOT@
PREV="$ROOT.prev"
TS=$(date +%Y%m%d-%H%M%S)

if [ ! -d "$PREV" ]; then
  echo "NO_PREVIOUS_VERSION"
  exit 21
fi

echo "[1/3] switch back to previous version"
rm -rf "$ROOT.rollback-$TS"
mv "$ROOT" "$ROOT.rollback-$TS"
mv "$PREV" "$ROOT"

echo "[2/3] nginx test and reload"
nginx -t
systemctl reload nginx

echo "[3/3] verify over HTTP"
FAILED=0
for p in / /index.html /styles/tokens.css /scripts/app.js /i18n/en.json /views/home.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1$p") || code=000
  printf '    %-40s %s\\n' "$p" "$code"
  [ "$code" = "200" ] || FAILED=1
done
if [ "$FAILED" -ne 0 ]; then
  echo "ROLLBACK_HTTP_CHECK_FAILED"
  exit 22
fi

ls -1dt "$ROOT.rollback-"* 2>/dev/null | tail -n +2 | xargs -r rm -rf
echo "ROLLED_BACK_SHA $(sha256sum "$ROOT/index.html" | cut -d' ' -f1)"
echo "ROLLBACK_OK"
"""


def make_deploy_script(root, tar, sha):
    return DEFS.replace("@ROOT@", shlex.quote(root)) \
               .replace("@TAR@", shlex.quote(tar)) \
               .replace("@SHA@", shlex.quote(sha))


def make_rollback_script(root):
    return ROLLBACK_SCRIPT.replace("@ROOT@", shlex.quote(root))


def marker(output, key):
    for line in output.splitlines():
        if line.startswith(key + " "):
            return line[len(key) + 1:].strip()
    return None


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def resolve_password(args):
    password = os.environ.get("DEPLOY_PASS")
    if password:
        return password
    if not sys.stdin.isatty():
        print("ERROR: DEPLOY_PASS is not set and stdin is not a terminal.", file=sys.stderr)
        return None
    try:
        return getpass.getpass("SSH password for {}@{}: ".format(args.user, args.host))
    except (EOFError, KeyboardInterrupt):
        print()
        return None


def confirm(question):
    if not sys.stdin.isatty():
        return False
    sys.stdout.write(question + " [y/N] ")
    sys.stdout.flush()
    try:
        return input().strip().lower() in ("y", "yes")
    except EOFError:
        return False


def check_http(host):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    failed = []
    for path in KEY_PATHS:
        url = "http://{}{}".format(host, path)
        try:
            with opener.open(url, timeout=10) as resp:
                code = resp.status
        except urllib.error.HTTPError as exc:
            code = exc.code
        except Exception as exc:  # connection refused, timeout, ...
            code = "ERR({})".format(exc.__class__.__name__)
        print("    {:<40} {}".format(path, code))
        if code != 200:
            failed.append(path)
    return failed


def connect_or_fail(args, password):
    try:
        return connect(args, password)
    except ImportError:
        print("ERROR: paramiko is required:  python -m pip install paramiko", file=sys.stderr)
        return None
    except Exception as exc:  # auth, timeout, refused ...
        print("ERROR: cannot connect to {}@{}:{} -- {}: {}".format(
            args.user, args.host, args.port, exc.__class__.__name__, exc), file=sys.stderr)
        return None


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #
def do_deploy(args):
    files, skipped = collect_files(HERE)
    if not files:
        print("ERROR: nothing to deploy (empty file list).", file=sys.stderr)
        return 2
    total_bytes = sum(os.path.getsize(os.path.join(HERE, f)) for f in files)

    print("")
    print("  Source : {}".format(HERE))
    print("  Target : {}@{}  ->  {}".format(args.user, args.host, args.root))
    print("  Files  : {}  ({})".format(len(files), human_size(total_bytes)))
    if skipped:
        print("  Skipped: {}".format(", ".join(sorted(skipped)[:8]) +
                                  (" ..." if len(skipped) > 8 else "")))
    print("")

    if args.dry_run:
        tops = {}
        for f in files:
            top = f.split("/", 1)[0] if "/" in f else "(root)"
            tops[top] = tops.get(top, 0) + 1
        print("  Dry run only -- nothing uploaded.")
        for name in sorted(tops):
            print("    {:<28} {:>4} files".format(name, tops[name]))
        return 0

    if not args.yes and not confirm("Update the live site now?"):
        print("Aborted.")
        return 1

    password = resolve_password(args)
    if not password:
        print("ERROR: no password for SSH/sudo.", file=sys.stderr)
        return 2

    tmpdir = tempfile.mkdtemp(prefix="hayneko-deploy-")
    archive = os.path.join(tmpdir, "site.tar.gz")
    script_path = "/tmp/hayneko-deploy-{}.sh".format(int(time.time()))
    client = None
    try:
        print("[local] packing...")
        digest = build_archive(files, HERE, archive)
        size = os.path.getsize(archive)
        print("    {} ({}, sha256 {})".format(archive, human_size(size), digest[:16] + "..."))

        client = connect_or_fail(args, password)
        if client is None:
            return 10

        print("[1/4] uploading")
        upload_file(client, archive, REMOTE_TAR, size)

        remote_script = make_deploy_script(args.root, REMOTE_TAR, digest)
        upload_script(client, remote_script, script_path)

        print("[2/4] deploying on server")
        rc, output = run_remote(client, "sudo -S -k -p '' bash " + shlex.quote(script_path),
                                password=password, timeout=900)
        sys.stdout.write(output)
        sys.stdout.flush()

        if "DEPLOY_OK" not in output:
            print("")
            print("ERROR: deploy did not complete (exit {}).".format(rc))
            if "ROLLED_BACK" in output:
                print("       The server rolled back to the previous version.")
            return rc if rc not in (0, None) else 12

        print("[3/4] verifying from this machine")
        failed = check_http(args.host)
        if failed:
            print("ERROR: HTTP check failed for: {}".format(", ".join(failed)))
            print("       The site is live; run --rollback if needed.")
            return 13

        deployed_sha = marker(output, "DEPLOYED_SHA")
        local_sha = sha256_file(os.path.join(HERE, "index.html"))
        if deployed_sha and deployed_sha != local_sha:
            print("WARNING: remote index.html sha256 differs from local.")
        else:
            print("    index.html sha256 matches local")

        print("[4/4] done")
        print("")
        print("Deploy OK -> http://{}/".format(args.host))
        print("  files        : {}".format(marker(output, "DEPLOYED_FILES")))
        print("  previous kept: {}".format(marker(output, "PREV_DIR")))
        print("  backup       : {}".format(marker(output, "BACKUP")))
        return 0
    finally:
        if client is not None:
            try:
                run_remote(client, "rm -f {} {}".format(
                    shlex.quote(REMOTE_TAR), shlex.quote(script_path)), timeout=30)
            except Exception:
                pass
            try:
                client.close()
            except Exception:
                pass
        shutil.rmtree(tmpdir, ignore_errors=True)


def do_rollback(args):
    password = resolve_password(args)
    if not password:
        print("ERROR: no password for SSH/sudo.", file=sys.stderr)
        return 2

    client = connect_or_fail(args, password)
    if client is None:
        return 10

    script_path = "/tmp/hayneko-rollback-{}.sh".format(int(time.time()))
    try:
        upload_script(client, make_rollback_script(args.root), script_path)
        rc, output = run_remote(client, "sudo -S -k -p '' bash " + shlex.quote(script_path),
                                password=password, timeout=600)
        sys.stdout.write(output)
        sys.stdout.flush()
        if "ROLLBACK_OK" not in output:
            print("")
            print("ERROR: rollback did not complete (exit {}).".format(rc))
            if "NO_PREVIOUS_VERSION" in output:
                print("       No previous version found ({} does not exist).".format(
                    args.root + ".prev"))
            return rc if rc not in (0, None) else 21

        print("")
        print("Rollback OK -> http://{}/".format(args.host))
        failed = check_http(args.host)
        if failed:
            print("WARNING: HTTP check failed for: {}".format(", ".join(failed)))
            return 22
        print("  previous version restored; the replaced one is kept as {}.rollback-*".format(
            args.root))
        return 0
    finally:
        try:
            run_remote(client, "rm -f " + shlex.quote(script_path), timeout=30)
        except Exception:
            pass
        try:
            client.close()
        except Exception:
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Deploy the Hayneko static site to the Arch/nginx host.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--root", default=DEFAULT_ROOT,
                        help="remote webroot (default: %(default)s)")
    parser.add_argument("--dry-run", action="store_true",
                        help="pack and list files, do not connect")
    parser.add_argument("--rollback", action="store_true",
                        help="restore the previous version kept at html.prev")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="skip the confirmation prompt")
    args = parser.parse_args(argv)

    if not args.root.startswith("/"):
        parser.error("--root must be an absolute path")

    try:
        if args.rollback:
            return do_rollback(args)
        return do_deploy(args)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
