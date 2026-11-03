"""Compare the owner's ORIGINAL Windows log with the copy that reached Claude's session earlier (r8).

usage: python3 -I compare_windows_log_copies.py <evidence/windows dir>

Reads, never changes:
  verify-b6-r6-windows.log                 the original (received in the owner's D-6 ZIP): a 202-byte UTF-8 header
                                           with a byte-order mark, then UTF-16LE (PowerShell 5.1 Tee-Object)
  verify-b6-r6-windows.RECEIVED-COPY.log   the copy received on 2026-11-02 as a plain attachment (UTF-8, no NULs)
Writes:
  verify-b6-r6-windows.ORIGINAL-DECODED.DERIVED.txt   the original decoded (header as UTF-8, body as UTF-16LE),
                                                      re-encoded as UTF-8, ANSI colour codes removed — DERIVED
and prints the comparison: line counts, lines that differ, and whether every difference sits where the original
has a non-ASCII character (the characters the transfer replaced).
"""
import hashlib, re, sys

W = sys.argv[1].rstrip('/') + '/'
orig = open(W + 'verify-b6-r6-windows.log', 'rb').read()
recv = open(W + 'verify-b6-r6-windows.RECEIVED-COPY.log', 'rb').read()
sha = lambda b: hashlib.sha256(b).hexdigest()
assert orig[:3] == b'\xef\xbb\xbf', 'original: no UTF-8 byte-order mark'
HEADER = 202
assert orig[HEADER + 1] == 0 and orig[HEADER + 3] == 0, 'original: UTF-16LE does not start at byte 202'
text = orig[:HEADER].decode('utf-8-sig') + orig[HEADER:].decode('utf-16-le')
rtext = recv.decode('utf-8')
a, b = text.split('\r\n'), rtext.split('\r\n')
diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]


def ascii_skeleton(s):
    """The ASCII characters of s with every run of non-ASCII characters collapsed to one marker."""
    return re.sub('\x00+', '\x00', re.sub(r'[^\x00-\x7f]', '\x00', s))


def received_skeleton(s):
    """The received line with every run of replacement characters (and the control bytes and ASCII stand-ins the
    transfer produced inside such runs) collapsed to one marker."""
    s = s.replace(',%V%', '�')  # the original's box-drawing pair arrived as these four ASCII characters
    return re.sub('\x00+', '\x00', re.sub(r'(?:�|\x03)+', '\x00', s))


only_at_non_ascii = [i for i in diff if ascii_skeleton(a[i]) == received_skeleton(b[i])]
other = [i for i in diff if i not in only_at_non_ascii]
derived_header = ('DERIVED READING COPY - NOT EVIDENCE BY ITSELF.\r\n'
                  f'Made by Claude on 2026-11-02 from the ORIGINAL verify-b6-r6-windows.log (SHA-256 {sha(orig)}):\r\n'
                  'bytes 0-201 decoded as UTF-8 (byte-order mark dropped), bytes 202- decoded as UTF-16LE; re-encoded as UTF-8;\r\n'
                  'ANSI colour codes removed. Nothing else changed. The non-ASCII characters (for example "Γ£ô", "ΓÇö") are already\r\n'
                  'in the original: PowerShell read the test runner\'s UTF-8 output with another code page before writing it.\r\n'
                  'Line numbers below = line numbers of the original + 7.\r\n'
                  '------------------------------------------------------------------------------------------------------------------\r\n')
open(W + 'verify-b6-r6-windows.ORIGINAL-DECODED.DERIVED.txt', 'w', encoding='utf-8', newline='').write(
    derived_header + re.sub(r'\x1b\[[0-9;]*m', '', text))
print(f'original: {len(orig)} bytes, SHA-256 {sha(orig)}; UTF-8 header {HEADER} bytes (with BOM), UTF-16LE body {len(orig) - HEADER} bytes; NUL bytes {orig.count(0)}')
print(f'received copy: {len(recv)} bytes, SHA-256 {sha(recv)}; NUL bytes {recv.count(0)}; U+FFFD {rtext.count(chr(0xFFFD))}')
print(f'decoded original: {len(a)} lines, {sum(1 for c in text if ord(c) > 127)} non-ASCII characters, U+FFFD {text.count(chr(0xFFFD))}')
print(f'received copy: {len(b)} lines')
print(f'lines identical: {len(a) - len(diff)}; lines that differ: {len(diff)}')
print(f'  differ only where the original has non-ASCII characters: {len(only_at_non_ascii)}')
print(f'  any other difference: {len(other)}')
for i in other[:10]:
    print('   line', i + 1, repr(a[i][:120]), '|', repr(b[i][:120]))
print('ASCII text of every line identical:', len(other) == 0)
print('derived reading copy written:', 'verify-b6-r6-windows.ORIGINAL-DECODED.DERIVED.txt')
