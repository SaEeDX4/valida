"""Offline inspection of the FINAL b6-3 fixtures (r9) — the exact EML files used for the Outlook classic checks.

usage: python3 -I offline_inspection_r9.py <docs/qa/b6-3 dir> <approved image file>

Two kinds of evidence, labelled in the output and never interchangeable:

  [SOURCE INSPECTION]   the EML bytes parsed with Python's standard `email` package — a decoder independent of the
                        project's own tests/fixtures/mimeInspect.js — and the HTML parsed with html.parser.
  [BROWSER SIMULATION]  Chromium (Playwright) accessibility tree of each message's own HTML, with the image shown and
                        with the cid: image unresolvable (images not loaded). NOT Outlook, NOT Narrator.

Checks (per fixture unless stated):
  S1 identity: SHA-256 of each EML equals the value in the Stage 3 plan §1 / b6-3 report §4
  S2 MIME: multipart/alternative[text/plain, multipart/related[text/html, image/png]]; MIME-Version; charsets; transfer
     encodings; every header line 7-bit on the wire; no line over 998 octets; CRLF line ends
  S3 wording: decoded Subject, text/plain and text/html equal the template outputs saved beside the EML
     (SYNTHETIC-*.subject.txt / .txt / .html — T-01 pins those outputs to the approved copy)
  S4 CID: exactly one <img>; src="cid:X"; X equals the image part's Content-ID; the part is inline, image/png,
     filename and name "valida-logo.png"; its bytes equal the approved file; no other part; no external resource
     (http, https, //), no link, no tracking element
  S5 alt text: the image's alt is "Valida"; no aria-hidden anywhere
  S6 structure: <html lang="en" dir="ltr">; <title> equals the subject; utf-8; exactly one <h1>; every <table> has
     role="presentation"; no th / thead / caption / summary; the source order of the text blocks
  S7 without images: every non-empty line of the plain-text part occurs in the HTML's text, so no information
     depends on the image (whose only content is the logo, alt "Valida")
  S8 the image part's PNG chunks (any text or metadata chunk is listed with its content)
  S9 privacy, every decoded surface: all header fields (decoded), every part's headers and parameters, decoded
     bodies (HTML also with character references decoded), the PNG bytes, the raw message. Every email address
     found is classified: authorised synthetic routing identity / Message-ID / the synthetic candidate address.
     INT (internal, internal-long-values): the candidate address nowhere. ACK: only in To, with no display name.
     Also searched: phone-number shapes, resume-file shapes (.pdf / .doc / .docx), the words "resume" and "phone"
     outside the approved privacy note.
"""
import email, hashlib, html, json, os, re, sys
from email import policy
from html.parser import HTMLParser

Q = os.path.abspath(sys.argv[1]) + '/'
APPROVED = open(sys.argv[2], 'rb').read()
APPROVED_SHA = hashlib.sha256(APPROVED).hexdigest()
F = Q + 'fixtures/'
PLAN_HASHES = {
    'acknowledgement': 'b6ef30bb59d70a9a974307138fae1b6fd1b3558fafd90e098306886ff622fac8',
    'acknowledgement-long-values': 'fcbe391ab4b44e8a7344bf86c8b56049bbef815e6f6a1fdd519aa0834eaf1f24',
    'internal': 'c1fa146455fec319f9d5dffa6d586ca104fbbf420f4f98a0b44aa576643e4989',
    'internal-long-values': 'b4bfb7c677d7c84ba156b48a982017be7009d1f2ea84027b778d187f2cf76bc0',
}
ROUTING = {'notifications@synthetic.example.invalid': 'From (synthetic sender identity)',
           'careers@synthetic.example.invalid': 'Reply-To (synthetic careers identity)',
           'hr@synthetic.example.invalid': 'To of the internal notification (synthetic HR recipient)'}
CANDIDATE = 'candidate@synthetic.example.invalid'
PRIVACY_NOTE = 'Candidate details and the resume are stored privately in Valida and are not included in this email.'
ADDRESS = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
PHONE = re.compile(r'(?<![\w#])\+?\d[\d ()-]{8,}\d(?![\w])')
RESUME_FILE = re.compile(r'[\w.-]+\.(?:pdf|docx?|rtf|odt)\b', re.I)


class Html(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags, self.blocks, self.text, self._stack = [], [], [], []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        if tag in ('h1', 'p'):
            self._stack.append([tag, ''])

    def handle_endtag(self, tag):
        if tag in ('h1', 'p') and self._stack:
            t, s = self._stack.pop()
            if s.strip():
                self.blocks.append((t, ' '.join(s.split())))

    def handle_data(self, data):
        self.text.append(data)
        if self._stack:
            self._stack[-1][1] += data


def leaves(part, out):
    if part.is_multipart():
        for sub in part.iter_parts():
            leaves(sub, out)
    else:
        out.append(part)
    return out


def tree(part):
    if part.is_multipart():
        return {part.get_content_type(): [tree(p) for p in part.iter_parts()]}
    return part.get_content_type()


def png_chunks(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    i, out = 8, []
    while i < len(data):
        n = int.from_bytes(data[i:i + 4], 'big'); kind = data[i + 4:i + 8].decode('latin1')
        body = data[i + 8:i + 8 + n]
        out.append({'type': kind, 'bytes': n, **({'content': body.decode('latin1')[:120]} if kind in ('tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME') else {})})
        i += 12 + n
    return out


results, lines = {}, []
say = lines.append
say('J8 — offline inspection of the final b6-3 fixtures (r9). Python ' + sys.version.split()[0] + ', email package (policy.default). No email sent; nothing leaves the machine.')
say('Approved image: ' + os.path.basename(sys.argv[2]) + ' ' + APPROVED_SHA)
ok_all = True
for name in ('internal', 'internal-long-values', 'acknowledgement', 'acknowledgement-long-values'):
    raw = open(F + f'SYNTHETIC-{name}.eml', 'rb').read()
    r = {'checks': {}}
    def check(cid, cond, detail):
        global ok_all
        r['checks'][cid] = {'pass': bool(cond), 'detail': detail}
        ok_all = ok_all and bool(cond)
    sha = hashlib.sha256(raw).hexdigest()
    check('S1 identity', sha == PLAN_HASHES[name], sha)
    msg = email.message_from_bytes(raw, policy=policy.default)
    head_raw = raw.split(b'\r\n\r\n', 1)[0]
    lv = leaves(msg, [])
    plain = next(p for p in lv if p.get_content_type() == 'text/plain')
    htmlp = next(p for p in lv if p.get_content_type() == 'text/html')
    imgs = [p for p in lv if p.get_content_maintype() == 'image']
    wire_lines = raw.split(b'\r\n')
    check('S2 MIME', tree(msg) == {'multipart/alternative': ['text/plain', {'multipart/related': ['text/html', 'image/png']}]}
          and msg['MIME-Version'] == '1.0' and plain.get_content_charset() == 'utf-8' and htmlp.get_content_charset() == 'utf-8'
          and all(b < 128 for b in head_raw) and max(len(l) for l in wire_lines) <= 998 and b'\n' not in raw.replace(b'\r\n', b''),
          {'tree': tree(msg), 'transfer_encodings': [p['Content-Transfer-Encoding'] for p in lv], 'charsets': [p.get_content_charset() for p in lv],
           'headers_7bit': all(b < 128 for b in head_raw), 'max_line_octets': max(len(l) for l in wire_lines)})
    subject = str(msg['Subject'])
    text = plain.get_content(); htm = htmlp.get_content()
    saved_text = open(F + f'SYNTHETIC-{name}.txt', encoding='utf-8').read()
    saved_html = open(F + f'SYNTHETIC-{name}.html', encoding='utf-8').read()
    saved_subject = open(F + f'SYNTHETIC-{name}.subject.txt', encoding='utf-8').read().rstrip('\n')
    norm = lambda s: s.replace('\r\n', '\n')
    check('S3 wording', subject == saved_subject and norm(text) == norm(saved_text) and norm(htm) == norm(saved_html),
          {'subject_equal': subject == saved_subject, 'plain_equal': norm(text) == norm(saved_text), 'html_equal': norm(htm) == norm(saved_html)})
    hp = Html(); hp.feed(htm)
    img_tags = [a for t, a in hp.tags if t == 'img']
    img = imgs[0] if imgs else None
    cid = (img['Content-ID'] or '').strip('<>') if img else None
    ext = re.findall(r'''(?:src|href|background)\s*=\s*["']?\s*(?:https?:|//)|url\(\s*["']?\s*(?:https?:|//)''', htm, re.I)
    check('S4 CID', len(img_tags) == 1 and len(imgs) == 1 and img_tags[0].get('src') == f'cid:{cid}' and img.get_content_disposition() == 'inline'
          and img.get_filename() == 'valida-logo.png' and img.get_param('name') == 'valida-logo.png'
          and hashlib.sha256(img.get_content()).hexdigest() == APPROVED_SHA and not ext and not any(t == 'a' for t, _ in hp.tags)
          and len(re.findall(r'cid:', htm)) == 1,
          {'img_src': img_tags[0].get('src') if img_tags else None, 'content_id': cid, 'disposition': img.get_content_disposition() if img else None,
           'filename': img.get_filename() if img else None, 'image_sha256': hashlib.sha256(img.get_content()).hexdigest() if img else None,
           'image_bytes': len(img.get_content()) if img else None, 'external_resources': len(ext), 'links': sum(1 for t, _ in hp.tags if t == 'a')})
    check('S5 alt text', len(img_tags) == 1 and img_tags[0].get('alt') == 'Valida' and 'aria-hidden' not in htm,
          {'alt': img_tags[0].get('alt') if img_tags else None, 'aria_hidden_present': 'aria-hidden' in htm})
    tables = [a for t, a in hp.tags if t == 'table']
    root = next(a for t, a in hp.tags if t == 'html')
    title = re.search(r'<title>(.*?)</title>', htm, re.S)
    check('S6 structure', root.get('lang') == 'en' and root.get('dir') == 'ltr' and title and html.unescape(title.group(1)) == subject
          and '<meta charset="utf-8">' in htm and sum(1 for t, _ in hp.tags if t == 'h1') == 1
          and tables and all(a.get('role') == 'presentation' for a in tables) and not any(t in ('th', 'thead', 'caption') for t, _ in hp.tags)
          and not any('summary' in a for a in tables),
          {'lang': root.get('lang'), 'dir': root.get('dir'), 'title_equals_subject': bool(title) and html.unescape(title.group(1)) == subject,
           'h1': sum(1 for t, _ in hp.tags if t == 'h1'), 'tables': len(tables), 'tables_presentation': sum(1 for a in tables if a.get('role') == 'presentation'),
           'source_order': [f'{t}: {s[:60]}' for t, s in hp.blocks]})
    html_text = ' '.join(' '.join(hp.text).split())
    # The plain text writes a metadata pair as "Label: value" on one line; the HTML has the label and the value as
    # two blocks. Each line is checked whole, or — for "Label: value" lines whose label is an HTML block — as its
    # label and its value separately.
    labels = {s for t, s in hp.blocks}
    def present(line):
        line = ' '.join(line.split())
        if line in html_text:
            return True
        label, sep, value = line.partition(': ')
        return bool(sep) and label in labels and value in html_text
    missing = [l for l in (x.strip() for x in text.splitlines()) if l and not present(l)]
    check('S7 without images', not missing, {'plain_lines_missing_from_html_text': missing})
    chunks = png_chunks(img.get_content())
    check('S8 PNG chunks', not any(c['type'] in ('tEXt', 'zTXt', 'iTXt', 'eXIf') for c in chunks), [c['type'] for c in chunks])
    # S9 privacy
    surfaces = [('header ' + k, str(v)) for k, v in msg.items()]
    for i, p in enumerate(lv):
        surfaces += [(f'part {i} header {k}', str(v)) for k, v in p.items()]
        surfaces += [(f'part {i} param {k}', str(v)) for k, v in (p.get_params() or [])]
        if p.get_content_maintype() == 'text':
            body = p.get_content(); surfaces.append((f'part {i} body {p.get_content_type()}', body))
            if p.get_content_type() == 'text/html':
                surfaces.append((f'part {i} body text/html (references decoded)', html.unescape(body)))
        else:
            surfaces.append((f'part {i} body {p.get_content_type()} (bytes as latin1)', p.get_content().decode('latin1')))
    surfaces.append(('raw message', raw.decode('latin1')))
    addresses = {}
    for where, s in surfaces:
        for a in ADDRESS.findall(s):
            addresses.setdefault(a.lower(), set()).add(where)
    classified = {}
    for a, places in sorted(addresses.items()):
        if a in ROUTING: kind = ROUTING[a]
        elif a == CANDIDATE: kind = 'THE SYNTHETIC CANDIDATE ADDRESS'
        elif re.fullmatch(r'[0-9a-f]{32}\.b6@synthetic\.example\.invalid', a): kind = 'Message-ID (opaque token, synthetic domain)'
        elif a == 'valida-logo.b6@cybervalida.com': kind = 'Content-ID of the inline logo (a fixed constant, not an address)'
        else: kind = 'UNCLASSIFIED'
        classified[a] = {'kind': kind, 'places': sorted(places)}
    is_int = name.startswith('internal')
    cand_places = classified.get(CANDIDATE, {}).get('places', [])
    decoded_text = '\n'.join(s for w, s in surfaces if w != 'raw message' and 'bytes as latin1' not in w)
    # Known non-personal values are removed before the shape searches: the UTC timestamp, the Application reference,
    # Message-ID tokens, and the format-detection directive (whose "telephone=no" is an instruction, not data).
    decoded_text = re.sub(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?', '<timestamp>', decoded_text)
    decoded_text = decoded_text.replace('0123456789abcdef01234567', '<application reference>')
    decoded_text = re.sub(r'[0-9a-f]{32}\.b6@', '<message-id token>@', decoded_text)
    decoded_text = re.sub(r'<meta name="format-detection"[^>]*>', '<format-detection directive>', decoded_text)
    for d in ('Mon, 26 Oct 2026 15:42:05 +0000',):
        decoded_text = decoded_text.replace(d, '<Date header>')
    phones = sorted(set(PHONE.findall(decoded_text)))
    files = sorted(set(RESUME_FILE.findall(decoded_text)))
    words = [w for w in ('resume', 'phone', 'linkedin', 'address:', 'street') if w in decoded_text.replace(PRIVACY_NOTE, '').replace('Candidate details and the resume', '').lower()]
    if is_int:
        priv_ok = not cand_places and not any(v['kind'] == 'UNCLASSIFIED' for v in classified.values())
    else:
        to_ok = str(msg['To']) == CANDIDATE and msg['To'].addresses[0].display_name == ''
        priv_ok = to_ok and set(cand_places) <= {'header To', 'raw message'} and not any(v['kind'] == 'UNCLASSIFIED' for v in classified.values())
    priv_ok = priv_ok and not phones and not files and not words
    check('S9 privacy', priv_ok, {'addresses': classified, 'phone_shapes': phones, 'resume_file_shapes': files, 'flagged_words_outside_note': words})
    results[name] = r

say('')
for name, r in results.items():
    say(f'== {name} (SYNTHETIC-{name}.eml)')
    for cid, c in r['checks'].items():
        d = c['detail']
        short = d if isinstance(d, str) else json.dumps(d, ensure_ascii=False)[:600]
        say(f'  [SOURCE INSPECTION] {cid}: {"PASS" if c["pass"] else "FAIL"} — {short}')

# Part 2 — browser simulation
from playwright.sync_api import sync_playwright
P = Q + 'previews/'
say('')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    say(f'[BROWSER SIMULATION] Chromium {b.version} accessibility tree (Playwright aria_snapshot) — NOT Outlook, NOT Narrator')
    for name in ('internal-long-values', 'acknowledgement'):
        for label, path in (('image shown', P + f'as-built-{name}.from-eml.html'), ('image not loaded (cid: unresolvable)', F + f'SYNTHETIC-{name}.html')):
            pg = b.new_page(viewport={'width': 680, 'height': 900})
            pg.goto('file://' + path); pg.wait_for_load_state('load')
            snap = pg.locator('body').aria_snapshot()
            pg.close()
            roles = re.findall(r'^\s*- (\w+)', snap, re.M)
            say(f'  {name} — {label}: roles {sorted(set(roles))}; table roles: {roles.count("table") + roles.count("row") + roles.count("cell")}; headings: {roles.count("heading")}')
            for l in snap.splitlines():
                say('    ' + l[:150])
            results.setdefault('_browser', {})[f'{name} / {label}'] = snap
    b.close()
say('')
say('SOURCE INSPECTION overall: ' + ('PASS' if ok_all else 'FAIL'))
open(Q + 'evidence/J8-offline-inspection.json', 'w').write(json.dumps(results, indent=1, ensure_ascii=False, default=sorted))
print('\n'.join(lines))
sys.exit(0 if ok_all else 1)
