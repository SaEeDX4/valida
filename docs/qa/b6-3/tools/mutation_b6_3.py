"""Mutations for the b6-3 build (C2 masthead + P-04), made in a scratch copy of backend/ only.

usage: python3 mutation_b6_3.py <scratch backend dir> <M1..M8> [<replacement png>]

Carried over from docs/qa/b6-stage2/tools/mutation_integrated.py (M1-M5), with the asset path of b6-3:
M1  internal plain text gains the candidate address              (T-07 must fail)
M2  internal HTML gains the address as numeric character refs   (T-07 must fail)
M3  acknowledgement HTML footer gains the candidate address     (T-07 must fail)
M4  the masthead asset file is replaced by other PNG bytes      (T-08 must fail; composing must refuse)
M5  compose() no longer attaches the image                       (T-08 must fail)
New for b6-3:
M6  the header label CAREERS is put back above the masthead      (T-01 and T-13 must fail)
M7  the eyebrow colour reverts to #66B3FF                        (T-13 must fail)
M8  the metadata labels revert to #7E8997                        (T-13 must fail)
"""
import os, shutil, sys

root, which = sys.argv[1], sys.argv[2]
templates = os.path.join(root, 'src/integrations/notifications/templates.js')
transport = os.path.join(root, 'src/integrations/notifications/smtpTransport.js')
asset = os.path.join(root, 'src/integrations/notifications/assets/valida-email-masthead-1200x216.png')


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
if which == 'M6':
    edit(templates, [("    `<tr>${cell(COLOR.canvas, 'padding:0;font-size:0;line-height:0;', MASTHEAD_IMAGE)}</tr>`,",
                      "    `<tr>${cell(COLOR.canvas, 'padding:0 40px;', `<p style=\"${STYLE.footer}\">CAREERS</p>`)}</tr>`,\n"
                      "    `<tr>${cell(COLOR.canvas, 'padding:0;font-size:0;line-height:0;', MASTHEAD_IMAGE)}</tr>`,")])
if which == 'M7':
    edit(templates, [("  eyebrow: '#83C6FF',", "  eyebrow: '#66B3FF',")])
if which == 'M8':
    edit(templates, [("text-transform:uppercase;color:${COLOR.body};`,\n  metaValue", "text-transform:uppercase;color:#7E8997;`,\n  metaValue")])
print(which, 'applied')
