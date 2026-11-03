"""Offline REVIEW MOCKUP EMLs for the owner's next Outlook classic check — PROPOSED candidates, NOT product output.

usage: python3 make_review_emls.py <repo root>

Each mockup starts from an integrated b6-2 fixture EML (docs/qa/b6-stage2/fixtures/SYNTHETIC-*.eml) and changes
only what the candidate changes:
  - the text/html part: f01_variants.apply(...) (the same markup as the Chromium previews), CID kept;
  - the one image/png part: its bytes replaced by the candidate PNG (Content-ID, filename and disposition kept);
  - the Subject: prefixed with "[REVIEW MOCKUP <variant>] " so every screenshot identifies the variant;
  - an added header "X-Valida-Review: PROPOSED mockup <variant>; not product output; do not send".
Nothing else is edited: From, To, Date, Message-ID, Auto-Submitted, the text/plain part and the MIME tree
(alternative[text/plain, related[text/html, image/png]]) are carried over. Python's email package re-serialises
the message, so line folding and encoding details differ from nodemailer's output; sizes are therefore
indicative only.

It also writes CONTROL-F02-plain-layout.eml: a minimal synthetic HTML message with no Valida markup (a dark
body and one 100 %-width table), used only to tell a client/environment layout width from a template effect
(finding F-02).

All addresses are synthetic (*.example.invalid). These files are for opening locally with the network
disconnected; they must never be sent.
"""
import email, email.policy, hashlib, json, os, sys
from email.message import EmailMessage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from f01_variants import apply

root = os.path.abspath(sys.argv[1])
FIX = os.path.join(root, 'docs/qa/b6-stage2/fixtures')
CAND = os.path.join(root, 'docs/qa/b6-stage3/proposals/f01-logo')
OUT = os.path.join(root, 'docs/qa/b6-stage3/proposals/review-emls')
os.makedirs(OUT, exist_ok=True)
sha = lambda b: hashlib.sha256(b).hexdigest()
POLICY = email.policy.SMTP  # CRLF line endings, as in the fixtures
IMAGES = {'C2': 'C2-masthead-1200x216.png', 'C3': 'C3-plate-412x144.png'}

index = []
for variant in ('C2', 'C3'):
    png = open(os.path.join(CAND, IMAGES[variant]), 'rb').read()
    for fixture in ('acknowledgement', 'internal-long-values'):
        source_path = os.path.join(FIX, f'SYNTHETIC-{fixture}.eml')
        source = open(source_path, 'rb').read()
        msg = email.message_from_bytes(source, policy=email.policy.default)
        parts = list(msg.walk())
        assert [p.get_content_type() for p in parts] == ['multipart/alternative', 'text/plain', 'multipart/related', 'text/html', 'image/png']
        plain_before = parts[1].get_content()
        html_part, image_part = parts[3], parts[4]
        html = html_part.get_content().replace('\r\n', '\n')  # the part is CRLF on the wire; the .html fixture is LF
        assert html == open(os.path.join(FIX, f'SYNTHETIC-{fixture}.html'), encoding='utf-8').read()
        new_html = apply(html, variant, True)
        html_part.set_content(new_html, subtype='html', charset='utf-8', cte='quoted-printable')
        cid, disposition, ctype = image_part['Content-ID'], image_part['Content-Disposition'], image_part['Content-Type']
        image_part.set_content(png, maintype='image', subtype='png', cte='base64', disposition='inline', filename='valida-logo.png', cid=cid)
        image_part.set_param('name', 'valida-logo.png')  # keep the fixture's Content-Type name parameter
        assert image_part['Content-ID'] == cid and image_part.get_filename() == 'valida-logo.png'
        assert image_part.get_param('name') == 'valida-logo.png' and image_part.get_content_disposition() == 'inline'
        label = f'{variant}+P04'
        subject = str(msg['Subject'])
        msg.replace_header('Subject', f'[REVIEW MOCKUP {label}] {subject}')
        msg['X-Valida-Review'] = f'PROPOSED mockup {label}; not product output; do not send'
        data = msg.as_bytes(policy=POLICY)
        name = f'REVIEW-MOCKUP-{variant}-P04-{fixture}.eml'
        open(os.path.join(OUT, name), 'wb').write(data)
        # Read back and check what must be unchanged.
        back = email.message_from_bytes(data, policy=email.policy.default)
        bparts = list(back.walk())
        assert [p.get_content_type() for p in bparts] == ['multipart/alternative', 'text/plain', 'multipart/related', 'text/html', 'image/png']
        assert bparts[1].get_content().replace('\r\n', '\n') == plain_before.replace('\r\n', '\n')
        assert bparts[3].get_content().replace('\r\n', '\n') == new_html
        assert bparts[4].get_content() == png and bparts[4]['Content-ID'] == cid
        for header in ('From', 'To', 'Date', 'Message-ID', 'Auto-Submitted'):
            assert str(back[header]) == str(email.message_from_bytes(source, policy=email.policy.default)[header]), header
        assert 'http:' not in new_html and 'https:' not in new_html
        index.append({'file': name, 'variant': label, 'from_fixture': os.path.basename(source_path), 'fixture_sha256': sha(source),
                      'image': IMAGES[variant], 'image_sha256': sha(png), 'html_bytes': len(new_html.encode()),
                      'eml_bytes': len(data), 'fixture_eml_bytes': len(source), 'sha256': sha(data)})

# F-02 control: no Valida markup.
control = EmailMessage(policy=POLICY)
control['From'] = 'F-02 control <control@synthetic.example.invalid>'
control['To'] = 'reviewer@synthetic.example.invalid'
control['Subject'] = '[REVIEW CONTROL F-02] plain layout control (synthetic, no Valida template)'
control['Date'] = 'Mon, 26 Oct 2026 15:42:05 +0000'
control['Message-ID'] = '<f02-control.review@synthetic.example.invalid>'
control['X-Valida-Review'] = 'control message for finding F-02; not product output; do not send'
control.set_content('F-02 control: a full-width table on a dark body. No Valida template markup, no fixed widths, no images.\n')
control.add_alternative(
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>F-02 control</title></head>\n'
    '<body bgcolor="#05070A" style="margin:0;padding:0;background-color:#05070A;">\n'
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1E242B" style="width:100%;background-color:#1E242B;">'
    '<tr><td style="padding:24px;font-family:\'Segoe UI\',Arial,sans-serif;font-size:16px;line-height:24px;color:#F4F7FA;">'
    'F-02 control: a full-width table on a dark body. No Valida template markup, no fixed widths, no images.'
    '</td></tr></table>\n</body></html>\n', subtype='html')
data = control.as_bytes(policy=POLICY)
open(os.path.join(OUT, 'CONTROL-F02-plain-layout.eml'), 'wb').write(data)
index.append({'file': 'CONTROL-F02-plain-layout.eml', 'variant': 'F-02 control', 'eml_bytes': len(data), 'sha256': sha(data)})

json.dump({'status': 'PROPOSED review mockups and one control — NOT product output; open locally, offline; never send',
           'python': sys.version.split()[0], 'files': index}, open(os.path.join(OUT, 'review-emls-index.json'), 'w'), indent=2)
for row in index:
    print(row['file'], row['eml_bytes'], row.get('fixture_eml_bytes', ''), row['sha256'][:16])
