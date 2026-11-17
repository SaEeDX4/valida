/**
 * C6-T6 — the Sentry SDK as the document server installs it
 * (frontend/package.json pins @sentry/core exactly; server-side only — no
 * file under src/ imports it, so it is never part of the browser bundle).
 * The event rules are shared with the API:
 * backend/src/lib/monitoring/errorMonitor.js.
 */
import { Scope, createStackParser, createTransport } from '@sentry/core';
import { ServerRuntimeClient, nodeStackLineParser } from '@sentry/core/server';

export const SENTRY_SDK = Object.freeze({ ServerRuntimeClient, Scope, createStackParser, createTransport, nodeStackLineParser });
