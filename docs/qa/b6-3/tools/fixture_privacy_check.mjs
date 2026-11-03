// Copied from docs/qa/b6-stage2/tools/fixture_privacy_check.mjs; b6-3 adds the acknowledgement with long values.
import fs from 'node:fs';
import path from 'node:path';
const [backendRoot, dir] = process.argv.slice(2);
const { parseMime, surfaces } = await import(path.join(backendRoot, 'tests/fixtures/mimeInspect.js'));
const marker = 'candidate@synthetic.example.invalid';
for (const name of ['internal', 'internal-long-values', 'acknowledgement', 'acknowledgement-long-values']) {
  const raw = fs.readFileSync(path.join(dir, `SYNTHETIC-${name}.eml`));
  const places = surfaces(parseMime(raw));
  const hits = places.filter((p) => String(p.text).toLowerCase().includes(marker)).map((p) => p.header ? `header:${p.header}` : p.where);
  const rawHits = raw.toString('latin1').split('\r\n').filter((l) => l.toLowerCase().includes(marker)).map((l) => l.split(':')[0]);
  console.log(name, '| decoded surfaces with the synthetic candidate address:', JSON.stringify(hits), '| raw lines:', JSON.stringify(rawHits));
}
