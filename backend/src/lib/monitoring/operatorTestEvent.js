import { resolveErrorMonitoring } from '../../config/errorMonitoring.js';
import { resolveReleaseIdentity } from '../../config/releaseIdentity.js';
import { createErrorMonitor, sendOperatorTestEvent } from './errorMonitor.js';

/**
 * C6-T6 — the operator's monitoring test event (C6 plan r3 §8.5: "a test
 * error event with the release tag and no personal data"), for each service:
 *
 *   backend:   npm run ops:monitoring:test-event
 *   frontend:  npm run monitoring:test-event
 *
 * It reads only SENTRY_DSN, APP_ENV, NODE_ENV and RENDER_GIT_COMMIT, sends
 * ONE event built by errorMonitor.js (kind `operator_test`, fixed text), and
 * prints one JSON line: whether it was delivered and the receiver's status —
 * never the DSN. Exit 0 only when the receiver accepted it.
 */
export async function runOperatorTestEvent({ env = process.env, service, sdk, write = (line) => process.stdout.write(`${line}\n`) }) {
  const appEnv = env.APP_ENV || 'local';
  const monitoring = resolveErrorMonitoring({ dsn: env.SENTRY_DSN, appEnv, nodeEnv: env.NODE_ENV });
  if (!monitoring.ok) {
    write(JSON.stringify({ service, sent: false, reason: 'invalid_configuration', variable: monitoring.variable, rule: monitoring.rule }));
    return 2;
  }
  const release = resolveReleaseIdentity(env);
  if (!release.ok) {
    write(JSON.stringify({ service, sent: false, reason: 'invalid_configuration', variable: release.variable, rule: release.rule }));
    return 2;
  }
  const monitor = createErrorMonitor({ monitoring, release, environment: appEnv, service, sdk });
  const result = await sendOperatorTestEvent(monitor);
  await monitor.close(2_000);
  write(
    JSON.stringify({
      service,
      environment: appEnv,
      release: release.sha,
      sent: result.sent,
      ...(result.sent ? { eventId: result.eventId, delivered: result.delivered, receiver: result.last } : { reason: result.reason }),
    }),
  );
  return result.sent && result.delivered ? 0 : 1;
}
