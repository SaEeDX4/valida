#!/bin/sh
# One scanner run: refresh signatures (incremental; a failure leaves the baked ones, whose age the
# scanner itself refuses beyond SCANNER_MAX_SIGNATURE_AGE_HOURS), start clamd on loopback, wait for
# VERSION, then run one batch (or the image self-test). clamd stops with the container.
set -u
freshclam --stdout --foreground; rc=$?
if [ "$rc" -gt 1 ]; then echo "{\"scanner-image\":\"freshclam-failed\",\"exit\":$rc}" >&2; fi
clamd &
node -e '
const net = require("node:net");
const until = Date.now() + 240000;
function probe() {
  let done = false;
  let out = "";
  const s = net.connect(3310, "127.0.0.1");
  const next = () => {
    if (done) return;
    done = true;
    s.destroy();
    if (/^ClamAV /.test(out)) process.exit(0);
    if (Date.now() > until) { console.error("{\"scanner-image\":\"clamd-not-ready\"}"); process.exit(1); }
    setTimeout(probe, 2000);
  };
  s.setTimeout(5000, next);
  s.on("connect", () => s.end("zVERSION\0"));
  s.on("data", (d) => { out += d; });
  s.on("close", next);
  s.on("error", next);
}
probe();' || exit 1
if [ "${SCANNER_IMAGE_SELFTEST:-}" = "1" ]; then exec node /app/ops/scanner/selftest.mjs; fi
exec node scripts/resume-scan.mjs
