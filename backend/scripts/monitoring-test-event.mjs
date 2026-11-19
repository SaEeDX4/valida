#!/usr/bin/env node
/**
 * C6-T6 — sends ONE operator test event from the API's monitoring
 * configuration (backend/src/lib/monitoring/operatorTestEvent.js).
 *   npm run ops:monitoring:test-event
 */
import { runOperatorTestEvent } from '../src/lib/monitoring/operatorTestEvent.js';
import { SENTRY_SDK } from '../src/lib/monitoring/sentrySdk.js';

process.exitCode = await runOperatorTestEvent({ service: 'valida-api', sdk: SENTRY_SDK });
