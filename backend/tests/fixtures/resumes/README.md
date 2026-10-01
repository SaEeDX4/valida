# Synthetic resume fixtures (B4)

Every file here is a **synthetic QA document** — it says "QA TEST DOCUMENT - NOT
A REAL CANDIDATE" and contains no real resume, name or personal data
(17_QA_TEST_PLAN.md sections 29-31 and 414). Their metadata was checked: no
author name, user name, host name or local path.

They were produced by real authoring tools, so the validator is tested against
what those tools actually write, not only against hand-built bytes (those are
in `../resumeFiles.js`). All from the same synthetic Markdown text, on Linux,
2026-09-28:

| File | Produced by | Expected as resume |
| --- | --- | --- |
| `qa-libreoffice.docx` | LibreOffice 24.2 (`soffice --convert-to docx`) | accepted |
| `qa-pandoc.docx` | pandoc 3.1.3 | accepted |
| `qa-python-docx.docx` | python-docx 1.2.0 (parts from its default template, which was saved by Microsoft Word for Mac; ZIP written by Python's zipfile) | accepted |
| `qa-libreoffice.pdf` | LibreOffice 24.2 (`--convert-to pdf`) | accepted |
| `qa-chromium-print.pdf` | Chromium 141 print-to-PDF (Skia/PDF) | accepted |
| `qa-reportlab.pdf` | ReportLab | accepted |
| `qa-qpdf-linearized-objstm.pdf` | qpdf `--object-streams=generate --linearize` of the LibreOffice PDF (xref stream, linearized) | accepted |
| `qa-libreoffice-legacy.doc` | LibreOffice, "MS Word 97" (OLE2) | refused (legacy .doc) |
| `qa-libreoffice-macro-format.docm` | LibreOffice, "MS Word 2007 XML VBA" | refused (macro-enabled type) |
| `qa-libreoffice-template.dotx` | LibreOffice, "MS Word 2007 XML Template" | refused (template) |
| `qa-libreoffice-sheet.xlsx` | LibreOffice Calc | refused (not a Word document) |
| `qa-pandoc.odt` | pandoc | refused (ODF, not OOXML) |

`.gitattributes` marks them binary so Git on Windows never rewrites them.
