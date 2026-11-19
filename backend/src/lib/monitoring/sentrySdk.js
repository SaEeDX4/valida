/**
 * C6-T6 — the Sentry SDK as the API installs it (backend/package.json pins
 * @sentry/core exactly). Only the server-runtime client, the transport
 * factory, the Node stack-line parser and Scope are used: no automatic
 * instrumentation package (@sentry/node and its OpenTelemetry tree) is
 * installed. lib/monitoring/errorMonitor.js says what an event may contain.
 */
import { Scope, createStackParser, createTransport } from '@sentry/core';
import { ServerRuntimeClient, nodeStackLineParser } from '@sentry/core/server';

export const SENTRY_SDK = Object.freeze({ ServerRuntimeClient, Scope, createStackParser, createTransport, nodeStackLineParser });
