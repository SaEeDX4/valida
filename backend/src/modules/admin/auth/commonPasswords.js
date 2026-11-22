/**
 * A local common-password check — Doc 11 s44. Nothing is sent to any third party.
 *
 * Passwords here are at least 12 characters (shorter ones are already refused
 * by length). The list holds frequently breached long passwords and the
 * predictable constructions an attacker tries first; patterns catch the
 * repetitive, sequential and keyboard-walk variants of any length.
 */

const LIST = new Set(
  [
    '123456789012', '1234567890123', '12345678901234', '123456789123', '1234567891011', '111111111111',
    '000000000000', '123123123123', '123412341234', '121212121212', 'qwertyuiopas', 'qwertyuiop123',
    '1qaz2wsx3edc', '1q2w3e4r5t6y', '1q2w3e4r5t6y7u', 'zaq12wsxcde3', 'qazwsxedcrfv', 'asdfghjkl123',
    'password1234', 'password12345', 'password123456', 'passwordpassword', 'password1password',
    'p@ssw0rd1234', 'p@ssword1234', 'passw0rd1234', 'mypassword123', 'mypassword1234', 'thisismypassword',
    'iloveyou1234', 'iloveyouforever', 'letmein12345', 'letmeinplease', 'welcome12345', 'welcome123456',
    'welcometothejungle', 'administrator', 'administrator1', 'administrator123', 'admin1234567', 'adminadmin123',
    'changeme1234', 'changemenow1', 'default12345', 'secret123456', 'supersecret123', 'trustno1trustno1',
    'football1234', 'baseball1234', 'basketball12', 'liverpool1234', 'chelsea12345', 'superman1234',
    'batman123456', 'starwars1234', 'pokemon12345', 'princess1234', 'sunshine1234', 'whatever1234',
    'computer1234', 'internet1234', 'monkey123456', 'dragon123456', 'shadow123456', 'master123456',
    'michael12345', 'jennifer1234', 'jessica12345', 'charlie12345', 'qwerty123456', 'qwerty1234567',
    'qwertyqwerty', 'asdfasdfasdf', 'zxcvbnm12345', 'abcdefghijkl', 'abcdef123456', 'abc123abc123',
    'correcthorsebatterystaple', 'correct horse battery staple', 'thequickbrownfox', 'helloworld123',
    'hello1234567', 'summer202020', 'winter202020', 'spring202020', 'autumn202020', 'january12345',
    'valida123456', 'validavalida', 'valida2026!!', 'cybervalida1', 'cybervalida123', 'cybersecurity1',
    'cybersecurity123', 'security1234', 'security12345', 'securepassword', 'securepassword1', 'strongpassword',
    'strongpassword1', 'verysecurepassword', 'mysecurepassword', 'recruitment123', 'recruitment1',
  ].map((value) => value.toLowerCase()),
);

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', '0987654321', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz'];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890123456789'];

function isRepetition(value) {
  // One short unit repeated to fill the whole password (aaaa…, abcabc…, 1212…).
  for (let unit = 1; unit <= Math.floor(value.length / 2); unit += 1) {
    if (value.length % unit === 0 && value.slice(0, unit).repeat(value.length / unit) === value) return true;
  }
  return false;
}

function isWalk(value) {
  const sources = [...KEYBOARD_ROWS, ...SEQUENCES];
  const doubled = sources.flatMap((row) => [row, [...row].reverse().join('')]);
  // The whole password is a run along one row or alphabet (possibly wrapping).
  return doubled.some((row) => (row + row + row).includes(value));
}

export function isCommonPassword(password) {
  const value = String(password).toLowerCase();
  const compact = value.replace(/\s+/g, '');
  if (LIST.has(value) || LIST.has(compact)) return true;
  if (isRepetition(compact) || isWalk(compact)) return true;
  // "password" plus digits/symbols only, the most common construction.
  if (/^(pass(word)?|admin|welcome|letmein|qwerty|valida)[\d\W_]*$/.test(compact)) return true;
  return false;
}
