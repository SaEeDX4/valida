#!/usr/bin/env node
/**
 * C6-T6 — sends ONE operator test event from the document server's
 * monitoring configuration (backend/src/lib/monitoring/operatorTestEvent.js).
 *   npm run monitoring:test-event
 */
import { runOperatorTestEvent } from '../../backend/src/lib/monitoring/operatorTestEvent.js';
import { SENTRY_SDK } from '../server/monitoringSdk.js';

process.exitCode = await runOperatorTestEvent({ service: 'valida-documents', sdk: SENTRY_SDK });
