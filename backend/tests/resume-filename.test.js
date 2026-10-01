import { describe, it, expect } from 'vitest';
import { extensionOf, normalizeOriginalFilename } from '../src/modules/applications/resume/filename.js';

/**
 * B4 — original-filename normalisation (Doc 09 section 101, Doc 10 section
 * 98, Doc 13 sections 65 and 79, Doc 17 sections 123-124).
 *
 * The name is metadata only; these tests prove it is bounded and harmless
 * while a legitimate name — in any script — stays recognisable.
 */
const normalize = (value) => normalizeOriginalFilename(value);

describe('path components are removed, whichever separator is used', () => {
  it.each([
    ['../../resume.pdf', 'resume.pdf'],
    ['..\\..\\resume.pdf', 'resume.pdf'],
    ['/etc/passwd', 'passwd'],
    ['C:\\Users\\QA\\Documents\\resume.pdf', 'resume.pdf'],
    ['C:/Users/QA/resume.pdf', 'resume.pdf'],
    ['\\\\server\\share\\resume.pdf', 'resume.pdf'],
    ['dir/sub\\mixed/resume.docx', 'resume.docx'],
    ['resume.pdf/', ''],
    ['..', ''],
    ['.', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe('characters that could mislead or break a consumer are removed or replaced', () => {
  it.each([
    ['NUL byte', 'resume\u0000.pdf', 'resume.pdf'],
    ['control characters', 'res\u0001\u001fume\u007f.pdf', 'resume.pdf'],
    ['C1 controls', 'res\u0085ume\u009b.pdf', 'resume.pdf'],
    ['CR/LF (header injection)', 'resume\r\nX-Injected: 1.pdf', 'resume X-Injected_ 1.pdf'],
    ['bidirectional override (RLO trick)', 'resume\u202Efdp.exe', 'resumefdp.exe'],
    ['bidirectional isolates and marks', 'a\u2066b\u2069c\u200E\u200F.pdf', 'abc.pdf'],
    ['zero-width space, word joiner and BOM', '\uFEFFre\u200Bsu\u2060me.pdf', 'resume.pdf'],
    ['Windows-forbidden characters', 'a<b>c:d"e|f?g*h.pdf', 'a_b_c_d_e_f_g_h.pdf'],
    ['NTFS alternate data stream', 'resume.pdf:hidden.exe', 'resume.pdf_hidden.exe'],
    ['whitespace runs', 'my   resume\t\tfinal.pdf', 'my resume final.pdf'],
    ['leading dots (hidden files)', '...resume.pdf', 'resume.pdf'],
    ['trailing dots and spaces (dropped by Windows)', 'resume.pdf. . ', 'resume.pdf'],
  ])('%s', (_label, input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it.each(['CON.pdf', 'nul.docx', 'COM1.pdf', 'lpt9.docx', 'Aux.pdf', 'PRN'])(
    'prefixes the Windows device name %s',
    (input) => {
      expect(normalize(input)).toBe(`_${input}`);
    },
  );

  it('does not touch names that merely contain a device name', () => {
    expect(normalize('console.pdf')).toBe('console.pdf');
    expect(normalize('CONTRACT.pdf')).toBe('CONTRACT.pdf');
  });
});

describe('legitimate Unicode is preserved (Doc 17 section 124)', () => {
  it.each([
    ['Persian', 'رزومه-آزمایشی.pdf'],
    ['Arabic', 'السيرة الذاتية.docx'],
    ['Chinese', '简历_测试.pdf'],
    ['Japanese', '履歴書_テスト.docx'],
    ['Cyrillic', 'резюме.pdf'],
    ['Hindi (combining marks)', 'बायोडाटा.pdf'],
    ['emoji', 'qa-resume-📄.pdf'],
    ['Persian with a zero-width non-joiner (half-space)', 'رزومه\u200Cی-آزمایشی.pdf'],
    ['an emoji ZWJ sequence', 'qa-👩\u200D💻.pdf'],
  ])('%s', (_label, name) => {
    expect(normalize(name)).toBe(name);
  });

  it('composes to NFC, so the same visible name is always stored the same way', () => {
    const decomposed = 'Re\u0301sume\u0301.pdf';
    expect(normalize(decomposed)).toBe('Résumé.pdf');
    expect(normalize(decomposed)).toBe(normalize('Résumé.pdf'));
  });

  it('replaces a lone surrogate instead of storing an invalid string', () => {
    expect(normalize('re\uD800sume.pdf')).toBe('re\uFFFDsume.pdf');
  });
});

describe('length is bounded to 255 (Doc 10 section 98)', () => {
  it('cuts a long ASCII name and keeps the extension', () => {
    const result = normalize(`${'a'.repeat(1000)}.pdf`);
    expect(result).toHaveLength(255);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('never splits a grapheme: emoji and accented letters stay whole', () => {
    const result = normalize(`${'👩🏽‍💻'.repeat(100)}.docx`);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith('.docx')).toBe(true);
    const stem = result.slice(0, -'.docx'.length);
    expect(stem.length % '👩🏽‍💻'.length).toBe(0);
    expect(stem).toBe('👩🏽‍💻'.repeat(stem.length / '👩🏽‍💻'.length));
  });

  it('a name of exactly 255 characters is kept unchanged', () => {
    const name = `${'b'.repeat(251)}.pdf`;
    expect(normalize(name)).toBe(name);
  });

  it('an implausibly long "extension" is not preserved at the expense of the name', () => {
    const result = normalize(`resume.${'x'.repeat(400)}`);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.startsWith('resume.')).toBe(true);
  });
});

describe('non-strings and empty results', () => {
  it.each([undefined, null, 42, {}, ['a.pdf']])('%j becomes an empty name', (value) => {
    expect(normalize(value)).toBe('');
  });

  it('a name made only of removable characters becomes empty', () => {
    expect(normalize('\u202E\u200B . . ')).toBe('');
  });
});

describe('extensionOf', () => {
  it.each([
    ['resume.pdf', '.pdf'],
    ['Resume.PDF', '.pdf'],
    ['archive.tar.gz', '.gz'],
    ['resume.pdf.exe', '.exe'],
    ['resume', ''],
    ['.pdf', ''],
    ['resume.', ''],
  ])('%j -> %j', (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });
});

describe('normalisation runs in linear time (review finding)', () => {
  it.each([
    ['a long run of dots before the extension', `a${'.'.repeat(16_000)}b.pdf`],
    ['a long run of spaces and dots', `${' .'.repeat(8_000)}x.pdf`],
    ['a 16 KiB name of one character', 'x'.repeat(16 * 1024)],
  ])('%s', (_label, input) => {
    const started = performance.now();
    const result = normalize(input);
    expect(performance.now() - started).toBeLessThan(100);
    expect(result.length).toBeLessThanOrEqual(255);
  });
});
