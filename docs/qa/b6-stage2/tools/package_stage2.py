"""Package B6 Stage 2 work from the recovered working copy.

usage: python3 -I p_stage2_package.py interim|final OUTDIR

The baselines are rebuilt from scratch every time (git archive of ec15048 from
the read-only clone, then the verified r9, rev 4 and rev 6 ZIPs), and every
file that differs is packaged with its SHA-256. Nothing in the working copy is
changed, except that `final` (re)writes docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, tempfile, zipfile

WORK = '/home/claude/recovery/valida'
CLONE = '/home/claude/saeedx4/valida'
BASE_COMMIT = 'ec15048980c9e3e8134de4b3d7eeadc89b1aef96'
ATT = '/mnt/user-data/attachments/ab994395-5479-5e83-8485-0b086d19bf14'
LAYERS = [
    (f'{ATT}/fc04a677-valida-B6-final-r9.zip', 'f11d21e65f56ba956f452dd4c7015495323b5dbbb8ab333418a31a38768634ec'),
    (f'{ATT}/f8d07f4c-valida-B6-r9-acceptance-docs-rev4-stage1.zip', 'f03b4be80176f6d7864e0da2eb470aa9cb74b6301da16bd3fafc56a5973d240b'),
    ('/mnt/user-data/outputs/valida-B6-r9-acceptance-docs-rev6-overlay.zip', 'b91137ab217556579f653d36356a65e869b87af659e4493bb4a0fd53bae0c5a9'),
]
MANIFEST_IN_REPO = 'docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256'
FIXED_TIME = (2026, 10, 27, 0, 0, 0)
PREFIX = os.environ.get('PKG_PREFIX', 'valida-B6-stage2')
SYNTHETIC_ALLOWED = {'synthetic-local-test-password'}

sha = lambda b: hashlib.sha256(b).hexdigest()


def tree(root):
    out = {}
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ('node_modules', '.git')]
        for f in fn:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, root).replace(os.sep, '/')] = sha(open(p, 'rb').read())
    return out


def baselines(tmp):
    base = os.path.join(tmp, 'ec15048')
    os.makedirs(base)
    data = subprocess.run(['git', '-C', CLONE, 'archive', BASE_COMMIT], check=True, capture_output=True).stdout
    tarfile.open(fileobj=io.BytesIO(data)).extractall(base, filter='data')
    r9rev6 = os.path.join(tmp, 'r9rev6')
    shutil.copytree(base, r9rev6)
    for path, expected in LAYERS:
        actual = sha(open(path, 'rb').read())
        assert actual == expected, f'{path}: {actual} != {expected}'
        with zipfile.ZipFile(path) as z:
            z.extractall(r9rev6)
    return tree(base), tree(r9rev6)


EXCLUDE = [
    (re.compile(r'(^|/)node_modules/'), 'dependency'),
    (re.compile(r'(^|/)\.git/'), 'git'),
    (re.compile(r'(^|/)\.env($|\.(?!example$))'), 'environment file'),
    (re.compile(r'\.(sqlite3?|db|wt|bson|pem|key|p12|pfx)$'), 'database or key material'),
    (re.compile(r'(^|/)(storage|uploads|var)/'), 'runtime storage'),
]


def check_paths(paths):
    for p in paths:
        for rx, why in EXCLUDE:
            assert not rx.search(p), f'excluded ({why}): {p}'
        if p.endswith('.log'):
            assert p.startswith('docs/qa/b6-stage2/evidence/'), f'log outside evidence: {p}'


SECRET_PATTERNS = [
    re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    re.compile(rb'mongodb(\+srv)?://[^/\s:@]+:[^@\s]+@'),
    re.compile(rb'SMTP_PASSWORD\s*=\s*\S'),
    re.compile(rb'(?i)app[ _-]?password\s*[:=]\s*["\']?[a-z]{4}\s?[a-z]{4}'),
    re.compile(rb'saeed\.sharifzadeh', re.I),
    re.compile(rb'@(gmail|yahoo|hotmail|outlook)\.com', re.I),
    re.compile(rb'(?i)password\s*[:=]\s*["\']([^"\'\s]{6,})["\']'),
]


def scan(paths):
    findings = []
    for p in paths:
        data = open(os.path.join(WORK, p), 'rb').read()
        for rx in SECRET_PATTERNS:
            for m in rx.finditer(data):
                value = m.group(1).decode('utf8', 'replace') if m.groups() and m.group(1) else m.group(0).decode('utf8', 'replace')
                if value in SYNTHETIC_ALLOWED:
                    continue
                findings.append((p, rx.pattern.decode(), value[:60]))
    return findings


def write_zip(out, entries):
    """entries: list of (arcname, bytes)."""
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(entries):
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)


def manifest_text(title, rows):
    lines = [f'# {line}' for line in title] + [f'{h}  {p}' for p, h in rows]
    return ('\n'.join(lines) + '\n').encode()


def main(mode, outdir):
    with tempfile.TemporaryDirectory(dir='/tmp/claude-0/-home-claude/ab994395-5479-5e83-8485-0b086d19bf14/scratchpad') as tmp:
        base, r9rev6 = baselines(tmp)
        work = tree(WORK)
        removed_vs_r9rev6 = sorted(set(r9rev6) - set(work))
        removed_vs_base = sorted(set(base) - set(work))
        assert not removed_vs_r9rev6, removed_vs_r9rev6
        assert not removed_vs_base, removed_vs_base
        delta = sorted(p for p in work if r9rev6.get(p) != work[p] and p != MANIFEST_IN_REPO)
        cumulative_pre = sorted(p for p in work if base.get(p) != work[p])
        check_paths(set(delta) | set(cumulative_pre))
        findings = scan(sorted(set(delta) | set(cumulative_pre)))
        status = {p: ('modified' if p in r9rev6 else 'added') for p in delta}
        report = {'mode': mode, 'delta_files': len(delta), 'delta_added': sum(v == 'added' for v in status.values()),
                  'delta_modified': sum(v == 'modified' for v in status.values()), 'removed': 0,
                  'secret_scan_findings': findings}

        delta_title = [
            'B6 Stage 2 delta: every file Stage 2 adds (A) or modifies (M) against the recovered baseline',
            f'baseline = {BASE_COMMIT} + valida-B6-final-r9.zip + rev4 docs ZIP + rev6 overlay (in that order); no file is deleted',
            'format: <sha256>  <repository path>; this manifest does not list itself',
            *[f'{status[p][0].upper()} {p}' for p in delta],
        ]
        delta_rows = [(p, work[p]) for p in delta]

        if mode == 'final':
            with open(os.path.join(WORK, MANIFEST_IN_REPO), 'wb') as f:
                f.write(manifest_text(delta_title, delta_rows))
            work = tree(WORK)
            cumulative = sorted(p for p in work if base.get(p) != work[p])
            delta_zip = os.path.join(outdir, f'{PREFIX}-delta.zip')
            write_zip(delta_zip, [(p, open(os.path.join(WORK, p), 'rb').read()) for p in delta + [MANIFEST_IN_REPO]])
            cum_zip = os.path.join(outdir, f'{PREFIX}-cumulative.zip')
            write_zip(cum_zip, [(p, open(os.path.join(WORK, p), 'rb').read()) for p in cumulative])
            cum_manifest = os.path.join(outdir, f'{PREFIX}-cumulative.manifest.sha256')
            with open(cum_manifest, 'wb') as f:
                f.write(manifest_text([
                    f'B6 cumulative: every file that differs from {BASE_COMMIT} (r9 + rev4 + rev6 + Stage 2); no file is deleted',
                    'format: <sha256>  <repository path>'], [(p, work[p]) for p in cumulative]))
            shutil.copyfile(os.path.join(WORK, MANIFEST_IN_REPO), os.path.join(outdir, f'{PREFIX}-delta.manifest.sha256'))
            report.update(cumulative_files=len(cumulative), packages={os.path.basename(z): sha(open(z, 'rb').read()) for z in (delta_zip, cum_zip, cum_manifest, os.path.join(outdir, f'{PREFIX}-delta.manifest.sha256'))})
        else:
            cumulative = cumulative_pre
            readme = open(sys.argv[3], 'rb').read()
            entries = [('RECOVERY_README.md', readme),
                       ('MANIFEST.delta.sha256', manifest_text(delta_title, delta_rows)),
                       ('MANIFEST.cumulative.sha256', manifest_text([
                           f'B6 cumulative: every file that differs from {BASE_COMMIT} (r9 + rev4 + rev6 + Stage 2 so far); no file is deleted',
                           'format: <sha256>  <repository path> (the files are under cumulative/)'], [(p, work[p]) for p in cumulative]))]
            entries += [(f'delta/{p}', open(os.path.join(WORK, p), 'rb').read()) for p in delta]
            entries += [(f'cumulative/{p}', open(os.path.join(WORK, p), 'rb').read()) for p in cumulative]
            out = os.path.join(outdir, 'valida-B6-stage2-interim-recovery-2026-10-27.zip')
            write_zip(out, entries)
            report.update(cumulative_files=len(cumulative), packages={os.path.basename(out): sha(open(out, 'rb').read())})
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
