import mongoose from 'mongoose';
import { safeErrorSummary } from '../lib/safeError.js';
import { DEPENDENCY_STATE } from '../modules/health/readiness.js';

/**
 * MongoDB connectivity — Doc 07, Doc 10, Doc 15.
 *
 * Owns the connection lifecycle and keeps the `database` readiness dependency
 * truthful: it becomes ready only when Mongoose reports an open connection,
 * and unavailable the moment the connection drops.
 *
 * NOTHING ABOUT THE CONNECTION IS EVER LOGGED. The URI carries the database
 * credentials in its userinfo, and driver errors quote the host, the
 * replica-set members and sometimes the URI itself. Every log line here
 * therefore uses safeErrorSummary and never the connection string, the error
 * message, or the stack (Doc 13).
 *
 * Importing this module connects nothing. app.js stays importable without a
 * socket or a database; connection happens in the server bootstrap.
 */

/** Listeners attached by connectDatabase, per connection, so they can be removed. */
const ATTACHED = new WeakMap();

function detachListeners(connection) {
  const listeners = ATTACHED.get(connection);
  if (!listeners) return;
  for (const [event, handler] of Object.entries(listeners)) {
    connection.off?.(event, handler);
  }
  ATTACHED.delete(connection);
}

/** Bounded, classified connection failure. Carries no driver detail. */
export class DatabaseConnectionError extends Error {
  constructor() {
    super('The database connection could not be established.');
    this.name = 'DatabaseConnectionError';
  }
}

/**
 * Connects to MongoDB and wires readiness to the real connection state.
 *
 * @returns {Promise<mongoose.Connection>}
 * @throws {DatabaseConnectionError} on any failure — never the driver error,
 *   which would carry the host and credentials.
 */
export async function connectDatabase({ config, logger, readiness, mongooseInstance = mongoose }) {
  const connection = mongooseInstance.connection;

  /*
   * Readiness follows the real connection events rather than being set once at
   * startup. If the database goes away later, /health/ready must start
   * answering 503 so a load balancer stops sending traffic here.
   *
   * The Mongoose connection is process-wide, so listeners from an earlier call
   * are removed first: otherwise a second start in the same process would keep
   * reporting into a stale readiness registry and log every event twice.
   */
  detachListeners(connection);
  const listeners = {
    connected: () => {
      readiness.set('database', DEPENDENCY_STATE.READY);
      logger.info('database connected');
    },
    disconnected: () => {
      readiness.set('database', DEPENDENCY_STATE.UNAVAILABLE);
      logger.warn('database disconnected');
    },
    error: (error) => {
      readiness.set('database', DEPENDENCY_STATE.UNAVAILABLE);
      logger.error({ err: safeErrorSummary(error) }, 'database connection error');
    },
  };
  for (const [event, handler] of Object.entries(listeners)) connection.on(event, handler);
  ATTACHED.set(connection, listeners);

  try {
    await mongooseInstance.connect(config.mongodbUri, {
      // Fail fast at startup instead of hanging: an unreachable database
      // should surface as a bounded startup failure, not a silent stall.
      serverSelectionTimeoutMS: config.databaseConnectTimeoutMs,
      // Indexes are applied by an explicit, inspectable command, never
      // implicitly on first use (see db/indexes.js).
      autoIndex: false,
      autoCreate: false,
    });
  } catch (error) {
    readiness.set('database', DEPENDENCY_STATE.UNAVAILABLE);
    logger.error({ err: safeErrorSummary(error) }, 'database connection failed');
    throw new DatabaseConnectionError();
  }

  // `connect` resolves after 'connected' has already fired in some driver
  // versions, so the state is reconciled explicitly rather than relying on
  // event ordering.
  if (connection.readyState === 1) {
    readiness.set('database', DEPENDENCY_STATE.READY);
  }

  return connection;
}

/**
 * Closes the connection during graceful shutdown.
 *
 * Marks the dependency unavailable first, so a readiness probe arriving mid
 * shutdown gets an honest answer.
 */
export async function disconnectDatabase({ logger, readiness, mongooseInstance = mongoose } = {}) {
  readiness?.set('database', DEPENDENCY_STATE.UNAVAILABLE);
  const connection = mongooseInstance.connection;
  try {
    await connection.close(false);
    // Detached only after close, so the final 'disconnected' event is still
    // observed; afterwards a closed connection reports into nothing.
    detachListeners(connection);
    logger?.info('database connection closed');
  } catch (error) {
    logger?.error({ err: safeErrorSummary(error) }, 'database failed to close');
    throw new DatabaseConnectionError();
  }
}

/** True when Mongoose reports an open connection. */
export function isDatabaseConnected(mongooseInstance = mongoose) {
  return mongooseInstance.connection.readyState === 1;
}

/**
 * The production database connector used by server.js.
 *
 * startServer accepts a connector with this shape ({ connect, disconnect }) so
 * the HTTP lifecycle tests can run without a MongoDB server. Production never
 * passes one: `npm start` always uses this object, and therefore always
 * connects to the real database named by MONGODB_URI.
 */
export const mongoDatabase = Object.freeze({
  connect: connectDatabase,
  disconnect: disconnectDatabase,
});
