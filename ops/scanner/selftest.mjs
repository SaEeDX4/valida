// The image self-test (CI): the real clamd in this image, through the production scanner client.
// EICAR is the standard harmless anti-virus test string, assembled here at run time.
import { createClamdScanner } from '/app/backend/src/integrations/scanner/clamdScanner.js';

const scanner = createClamdScanner({ maxSignatureAgeHours: Number(process.env.SCANNER_MAX_SIGNATURE_AGE_HOURS ?? 48) });
const eicar = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''), 'latin1');
const version = await scanner.version();
const infected = await scanner.scan(eicar);
const clean = await scanner.scan(Buffer.from('%PDF-1.4\n% Valida scanner image self-test (synthetic)\n%%EOF\n'));
const ok = infected.verdict === 'INFECTED' && clean.verdict === 'CLEAN';
console.log(JSON.stringify({ selftest: ok ? 'PASS' : 'FAIL', engine: version.engine, signatureVersion: version.signatureVersion, signatureAgeHours: Math.round(version.ageHours), eicar: infected.verdict, signature: infected.signature ?? null, clean: clean.verdict }));
process.exit(ok ? 0 : 1);
