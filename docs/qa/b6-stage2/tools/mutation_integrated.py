"""Mutations for the INTEGRATED deliverable (logo applied), made in a scratch copy of backend/ only.

usage: python3 mutation_integrated.py <scratch backend dir> <M1|M2|M3|M4|M5> [<replacement png>]

M1  internal plain text gains the candidate address              (T-07 must fail)
M2  internal HTML gains the address as numeric character refs   (T-07 must fail)
M3  acknowledgement HTML footer gains the candidate address     (T-07 must fail)
M4  the logo asset file is replaced by other PNG bytes          (T-08 must fail; composing must refuse)
M5  compose() no longer attaches the logo                        (T-08 must fail)
"""
import os, shutil, sys

root, which = sys.argv[1], sys.argv[2]
templates = os.path.join(root, 'src/integrations/notifications/templates.js')
transport = os.path.join(root, 'src/integrations/notifications/smtpTransport.js')
asset = os.path.join(root, 'src/integrations/notifications/assets/valida-logo-email-316x72.png')


def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (which, old[:60])
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)


if which in ('M1', 'M2'):
    edit(templates, [('export function renderApplicationReceivedInternal({ applicationId, job, submittedAt }) {',
                      'export function renderApplicationReceivedInternal({ applicationId, job, submittedAt, candidateEmail }) {')])
if which == 'M1':
    edit(templates, [("    `Application reference: ${reference}`,\n", "    `Application reference: ${reference}`,\n    `Contact: ${candidateEmail}`,\n")])
if which == 'M2':
    edit(templates, [("      metadataRow('Application reference', escapeHtml(reference), true),\n",
                      "      metadataRow('Application reference', escapeHtml(reference), true),\n      metadataRow('Contact', [...String(candidateEmail)].map((c) => `&#${c.codePointAt(0)};`).join(''), true),\n")])
if which == 'M3':
    edit(templates, [('export function renderApplicationAcknowledgement({ job }) {', 'export function renderApplicationAcknowledgement({ job, candidateEmail }) {'),
                     ("      footer('Valida Careers'),\n", "      footer(`Valida Careers ${escapeHtml(candidateEmail)}`),\n")])
if which == 'M4':
    os.remove(asset)  # never write through a symlink or hard link
    shutil.copyfile(sys.argv[3], asset)
if which == 'M5':
    edit(transport, [("const usesLogo = typeof message.html === 'string' && message.html.includes(`cid:${EMAIL_LOGO.contentId}`);",
                      'const usesLogo = false;')])
print(which, 'applied')
