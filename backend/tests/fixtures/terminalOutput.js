import { stripVTControlCharacters } from 'node:util';

/**
 * TEST ONLY (B6 r8) — a child process's terminal output, as text.
 *
 * A child may colour its output even when it is piped: vitest's colour
 * detection turns colours on whenever the platform is Windows, or FORCE_COLOR
 * or CI is set (and off when NO_COLOR is set). On the first Windows run the
 * guard tests' literal match `Error: [test:db] ` failed on output containing
 * ANSI escape sequences; with FORCE_COLOR the runner writes
 * `ESC[31mESC[1mErrorESC[22m: [test:db] …` and the same match fails.
 *
 * Every semantic assertion on such output — positive AND negative — runs on
 * the text with the VT control sequences removed (Node's own
 * util.stripVTControlCharacters): an escape sequence inside a word can break a
 * match, and it can just as well hide a disclosure from a "must not contain"
 * check.
 */
export const plainText = (output) => stripVTControlCharacters(String(output ?? ''));

/** Whether `output` contains a VT control sequence (CSI / OSC). */
export const hasVTControlSequences = (output) => plainText(output) !== String(output ?? '');

/**
 * Environment overrides that make a child's colouring EXPLICIT, so a test
 * covers both forms on every platform: 'plain' (NO_COLOR — wins over every
 * other setting) or 'coloured' (FORCE_COLOR, as Windows behaves by default).
 */
export function withColourMode(env, mode) {
  const result = { ...env };
  delete result.NO_COLOR;
  delete result.FORCE_COLOR;
  if (mode === 'plain') result.NO_COLOR = '1';
  else if (mode === 'coloured') result.FORCE_COLOR = '1';
  else throw new TypeError(`unknown colour mode: ${mode}`);
  return result;
}

export const COLOUR_MODES = Object.freeze(['plain', 'coloured']);
