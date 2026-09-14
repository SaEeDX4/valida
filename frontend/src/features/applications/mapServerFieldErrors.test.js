import { describe, it, expect } from 'vitest';
import mapServerFieldErrors, { mapServerFieldPath } from './mapServerFieldErrors.js';

/** Cycle 4, finding 2 — canonical server field paths map onto form keys. */
describe('server field path mapping', () => {
  it.each([
    ['fullName', 'fullName'],
    ['email', 'email'],
    ['phone', 'phone'],
    ['message', 'message'],
    ['resume', 'resume'],
  ])('maps %s directly', (field, expected) => {
    expect(mapServerFieldPath(field)).toBe(expected);
  });

  it('maps a screening answer path onto the control key', () => {
    expect(mapServerFieldPath('screeningAnswers.q-short', new Set(['q-short']))).toBe('screening:q-short');
    expect(mapServerFieldPath('screeningAnswers.q_1', new Set(['q_1']))).toBe('screening:q_1');
  });

  it.each([
    ['an empty question id', 'screeningAnswers.'],
    ['an unknown field', 'someFutureField'],
    ['a nested unknown path', 'internal.db.column'],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a non-string', 42],
    ['null', null],
  ])('refuses to map %s', (_label, field) => {
    expect(mapServerFieldPath(field)).toBeNull();
  });

  it('never manufactures a key from an arbitrary path', () => {
    // A broken anchor is worse than no anchor: the summary would link nowhere.
    expect(mapServerFieldPath('screening:q-short')).toBeNull();
    expect(mapServerFieldPath('answers.q-short')).toBeNull();
  });
});

describe('mapping a server error list', () => {
  it('attaches mappable errors and drops the rest', () => {
    const result = mapServerFieldErrors([
      { field: 'email', message: 'Enter a valid email address.' },
      { field: 'screeningAnswers.q-short', message: 'Answer this question to continue.' },
      { field: 'internal.column', message: 'constraint violation' },
    ], { screeningQuestionIds: ['q-short', 'q-long'] });
    expect(result).toEqual({
      email: 'Enter a valid email address.',
      'screening:q-short': 'Answer this question to continue.',
    });
    expect(Object.keys(result)).not.toContain('internal.column');
  });

  it('falls back to safe wording when the server message is unusable', () => {
    expect(mapServerFieldErrors([{ field: 'resume', message: { evil: true } }], { screeningQuestionIds: ['q-short', 'q-long'] })).toEqual({
      resume: 'This field needs to be corrected.',
    });
    expect(mapServerFieldErrors([{ field: 'phone' }], { screeningQuestionIds: ['q-short', 'q-long'] })).toEqual({
      phone: 'This field needs to be corrected.',
    });
  });

  it('tolerates a malformed list', () => {
    expect(mapServerFieldErrors(null)).toEqual({});
    expect(mapServerFieldErrors(['nope', null, {}], { screeningQuestionIds: ['q-short', 'q-long'] })).toEqual({});
  });
});

describe('Cycle 5 — screening paths must name a configured question (finding 2)', () => {
  const ids = { screeningQuestionIds: ['q-known', 'q-other'] };

  it('maps a configured screening question', () => {
    expect(
      mapServerFieldErrors([{ field: 'screeningAnswers.q-known', message: 'Answer this.' }], ids),
    ).toEqual({ 'screening:q-known': 'Answer this.' });
  });

  it('does not map a question the active form does not configure', () => {
    const mapped = mapServerFieldErrors(
      [{ field: 'screeningAnswers.q-unknown', message: 'Answer this.' }],
      ids,
    );
    // No key at all, so no summary link and no anchor can be produced.
    expect(mapped).toEqual({});
    expect(Object.keys(mapped)).not.toContain('screening:q-unknown');
  });

  it('maps nothing when no allowed ids are supplied', () => {
    expect(mapServerFieldErrors([{ field: 'screeningAnswers.q-known', message: 'x' }])).toEqual({});
  });

  it('attaches known fields while dropping an unknown screening path', () => {
    const mapped = mapServerFieldErrors(
      [
        { field: 'email', message: 'Enter a valid email address.' },
        { field: 'screeningAnswers.q-known', message: 'Answer this.' },
        { field: 'screeningAnswers.q-unknown', message: 'Ignored.' },
      ],
      ids,
    );
    // A single unknown path must not discard real, actionable field errors.
    expect(mapped.email).toBe('Enter a valid email address.');
    expect(mapped['screening:q-known']).toBe('Answer this.');
    expect(mapped['screening:q-unknown']).toBeUndefined();
    expect(Object.keys(mapped)).toHaveLength(2);
  });

  it('keeps direct field paths working without any allowed ids', () => {
    expect(mapServerFieldErrors([{ field: 'resume', message: 'Bad file.' }])).toEqual({
      resume: 'Bad file.',
    });
  });

  it('ignores blank or malformed allowed ids', () => {
    expect(
      mapServerFieldErrors([{ field: 'screeningAnswers.q-known', message: 'x' }], {
        screeningQuestionIds: ['', '   ', null, 42],
      }),
    ).toEqual({});
  });
});
