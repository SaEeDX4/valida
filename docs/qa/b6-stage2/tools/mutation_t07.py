import sys
p, which = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
orig = s
if which in ('M1', 'M2'):
    s = s.replace('export function renderApplicationReceivedInternal({ applicationId, job, submittedAt }) {', 'export function renderApplicationReceivedInternal({ applicationId, job, submittedAt, candidateEmail }) {', 1)
if which == 'M1':
    s = s.replace("    `Application reference: ${reference}`,\n", "    `Application reference: ${reference}`,\n    `Contact: ${candidateEmail}`,\n", 1)
if which == 'M2':
    s = s.replace("      metadataRow('Application reference', escapeHtml(reference), true),\n", "      metadataRow('Application reference', escapeHtml(reference), true),\n      metadataRow('Contact', [...String(candidateEmail)].map((c) => `&#${c.codePointAt(0)};`).join(''), true),\n", 1)
if which == 'M3':
    s = s.replace('export function renderApplicationAcknowledgement({ job }) {', 'export function renderApplicationAcknowledgement({ job, candidateEmail }) {', 1)
    s = s.replace("      footer('Valida Careers'),\n    ],\n  });\n  return { subject, text, html };\n}", "      footer(`Valida Careers ${escapeHtml(candidateEmail)}`),\n    ],\n  });\n  return { subject, text, html };\n}", 1)
assert s != orig, which
open(p, 'w', encoding='utf-8').write(s)
