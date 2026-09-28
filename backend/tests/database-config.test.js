import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase, DatabaseConnectionError } from '../src/db/mongoose.js';
import { Readiness, DEPENDENCY_STATE } from '../src/modules/health/readiness.js';
import { createLogger } from '../src/lib/logger.js';
import { fakeMongoose } from './helpers.js';
import { mongoDatabase } from '../src/db/mongoose.js';
import { parseMongoUri } from '../src/db/connectionString.js';

/**
 * Database configuration and connection failure handling.
 *
 * A real connection is exercised in tests/db. These cover the configuration
 * contract and the failure path, both of which must stay bounded and must
 * never disclose the connection string.
 */
const SECRET_URI = 'mongodb+srv://admin:s3cr3t@cluster0.example.net/valida?retryWrites=true';
const baseEnv = { MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test' };

const capturing = () => {
  const lines = [];
  const logger = createLogger({ level: 'trace', destination: { write: (chunk) => lines.push(chunk) } });
  return { logger, output: () => lines.join('') };
};

describe('MONGODB_URI configuration', () => {
  it('is required — the backend will not start without a database', () => {
    expect(() => loadConfig({})).toThrow(/MONGODB_URI: is required/);
  });

  it('accepts both canonical schemes', () => {
    expect(loadConfig({ MONGODB_URI: 'mongodb://127.0.0.1:27017/valida' }).mongodbUri).toBeTruthy();
    expect(loadConfig({ MONGODB_URI: SECRET_URI }).mongodbUri).toBe(SECRET_URI);
  });

  it.each([
    ['an http URL', 'http://127.0.0.1:27017/valida'],
    ['a bare host', '127.0.0.1:27017'],
    ['an empty string', ''],
    ['whitespace padding', ' mongodb://127.0.0.1:27017/valida '],
    ['a missing host', 'mongodb://'],
    ['an SRV URI with a port', 'mongodb+srv://cluster0.example.net:27017/valida'],
    ['an SRV URI with several hosts', 'mongodb+srv://a.example.net,b.example.net/valida'],
    ['an out-of-range port', 'mongodb://db.example:99999/valida'],
    ['an unescaped "/" in the password', 'mongodb://user:pa/ss@db.example/valida'],
    ['an unescaped "@" in the password', 'mongodb://user:pa@ss@db.example/valida'],
    ['an unsupported option', 'mongodb://db.example/valida?notAnOption=1'],
    ['a database name containing "."', 'mongodb://db.example/valida.test'],
    ['a database name containing an encoded "/"', 'mongodb://db.example/valida%2Ftest'],
    ['a database name of 64 bytes', `mongodb://db.example/${'v'.repeat(64)}`],
    ['an internal space', 'mongodb://db.example/val ida'],
  ])('rejects %s', (_label, uri) => {
    expect(() => loadConfig({ MONGODB_URI: uri })).toThrow(/Invalid backend configuration:\n {2}- MONGODB_URI:/);
  });

  it.each([
    ['a standalone server', 'mongodb://127.0.0.1:27017/valida'],
    ['no explicit database', 'mongodb://127.0.0.1:27017'],
    ['escaped credentials and options', 'mongodb://valida_app:p%40ss%2Fw0rd@db.example:27017/valida?authSource=admin'],
    ['a replica-set host list (finding 3)', 'mongodb://db1.example:27017,db2.example:27017/valida_test?replicaSet=rs0'],
    ['a three-member replica set with TLS', 'mongodb://a.example,b.example:27018,c.example:27019/valida?replicaSet=rs0&tls=true'],
    ['an SRV record with options', 'mongodb+srv://cluster0.example.net/valida?retryWrites=true&w=majority'],
    ['an IPv6 host', 'mongodb://[::1]:27017/valida'],
    ['a Unix socket', 'mongodb://%2Ftmp%2Fmongodb-27017.sock/valida'],
    ['a 63-byte database name', `mongodb://db.example/${'v'.repeat(63)}`],
  ])('accepts %s', (_label, uri) => {
    expect(loadConfig({ MONGODB_URI: uri }).mongodbUri).toBe(uri);
  });

  it('never quotes a host, credential or option when a MongoDB URI is rejected', () => {
    const rejected = [
      'mongodb+srv://admin:s3cr3t@cluster0.example.net:27017/valida',
      'mongodb://admin:s3cr3t@db1.example:99999,db2.example/valida?replicaSet=rs0',
      'mongodb://admin:s3cr3t@db1.example/valida?AKIAEXAMPLE=1',
    ];
    for (const uri of rejected) {
      let text = '';
      try {
        loadConfig({ MONGODB_URI: uri });
      } catch (error) {
        text = `${error.message} ${JSON.stringify(error.issues)}`;
      }
      expect(text).toMatch(/MONGODB_URI: must be a valid MongoDB connection string/);
      [/s3cr3t/, /admin:/, /cluster0/, /db1\.example/, /99999/, /AKIAEXAMPLE/, /replicaSet/].forEach((pattern) =>
        expect(text, `leaked ${pattern}`).not.toMatch(pattern),
      );
    }
  });

  it('never echoes the rejected connection string', () => {
    let message = '';
    try {
      loadConfig({ MONGODB_URI: SECRET_URI.replace('mongodb+srv', 'ftp') });
    } catch (error) {
      message = `${error.message} ${JSON.stringify(error.issues ?? [])}`;
    }
    expect(message).toContain('MONGODB_URI');
    [/s3cr3t/, /admin:/, /cluster0/, /example\.net/, /retryWrites/].forEach((pattern) =>
      expect(message, `leaked ${pattern}`).not.toMatch(pattern),
    );
  });

  it('validates the connect timeout', () => {
    expect(loadConfig(baseEnv).databaseConnectTimeoutMs).toBe(10_000);
    expect(() => loadConfig({ ...baseEnv, MONGODB_CONNECT_TIMEOUT_MS: '10' })).toThrow(/MONGODB_CONNECT_TIMEOUT_MS/);
  });
});

describe('connection failure is bounded and silent about detail', () => {
  /** A stand-in whose connect rejects with a realistic, secret-bearing driver error. */
  const failingMongoose = () => {
    const handlers = {};
    const driverError = new Error(
      `getaddrinfo ENOTFOUND cluster0.example.net — connection ${SECRET_URI} failed`,
    );
    driverError.name = 'MongooseServerSelectionError';
    return {
      connection: {
        readyState: 0,
        on: (event, handler) => { handlers[event] = handler; },
        close: vi.fn().mockResolvedValue(undefined),
      },
      connect: vi.fn().mockRejectedValue(driverError),
      handlers,
    };
  };

  it('throws a classified DatabaseConnectionError, not the driver error', async () => {
    const readiness = new Readiness();
    const { logger } = capturing();
    await expect(
      connectDatabase({ config: loadConfig(baseEnv), logger, readiness, mongooseInstance: failingMongoose() }),
    ).rejects.toBeInstanceOf(DatabaseConnectionError);
  });

  it('marks the database dependency unavailable on failure', async () => {
    const readiness = new Readiness();
    const { logger } = capturing();
    await connectDatabase({ config: loadConfig(baseEnv), logger, readiness, mongooseInstance: failingMongoose() }).catch(() => {});
    expect(readiness.describe().dependencies.find((d) => d.name === 'database').state).toBe(
      DEPENDENCY_STATE.UNAVAILABLE,
    );
    expect(readiness.isReady()).toBe(false);
  });

  it('writes no connection string, credential or driver message to the log', async () => {
    const readiness = new Readiness();
    const { logger, output } = capturing();
    await connectDatabase({ config: loadConfig(baseEnv), logger, readiness, mongooseInstance: failingMongoose() }).catch(() => {});

    const logged = output();
    expect(logged).toMatch(/database connection failed/);
    [/mongodb\+srv/, /s3cr3t/, /admin:/, /cluster0/, /ENOTFOUND/, /"stack"/].forEach((pattern) =>
      expect(logged, `leaked ${pattern}`).not.toMatch(pattern),
    );
  });

  it('carries no message or stack on the thrown error', async () => {
    const readiness = new Readiness();
    const { logger } = capturing();
    const error = await connectDatabase({
      config: loadConfig(baseEnv), logger, readiness, mongooseInstance: failingMongoose(),
    }).catch((caught) => caught);
    expect(error.message).toBe('The database connection could not be established.');
    expect(`${error.message}`).not.toMatch(/s3cr3t|cluster0|ENOTFOUND/);
  });
});

describe('connection events keep readiness truthful', () => {
  const trackingMongoose = () => {
    const handlers = {};
    return {
      connection: {
        readyState: 1,
        on: (event, handler) => { handlers[event] = handler; },
        close: vi.fn().mockResolvedValue(undefined),
      },
      connect: vi.fn().mockResolvedValue(undefined),
      handlers,
    };
  };

  it('becomes ready on a successful connection', async () => {
    const readiness = new Readiness();
    const instance = trackingMongoose();
    await connectDatabase({ config: loadConfig(baseEnv), logger: capturing().logger, readiness, mongooseInstance: instance });
    expect(readiness.describe().dependencies.find((d) => d.name === 'database').state).toBe('ready');
  });

  it('becomes unavailable when the connection is later lost', async () => {
    const readiness = new Readiness();
    const instance = trackingMongoose();
    await connectDatabase({ config: loadConfig(baseEnv), logger: capturing().logger, readiness, mongooseInstance: instance });
    instance.handlers.disconnected();
    expect(readiness.describe().dependencies.find((d) => d.name === 'database').state).toBe('unavailable');
  });

  it('marks unavailable before closing during shutdown', async () => {
    const readiness = new Readiness();
    const instance = trackingMongoose();
    await connectDatabase({ config: loadConfig(baseEnv), logger: capturing().logger, readiness, mongooseInstance: instance });
    await disconnectDatabase({ logger: capturing().logger, readiness, mongooseInstance: instance });
    expect(readiness.describe().dependencies.find((d) => d.name === 'database').state).toBe('unavailable');
    expect(instance.connection.close).toHaveBeenCalled();
  });
});

describe('readiness still reflects unimplemented milestones', () => {
  it('stays not ready with only configuration and database ready', () => {
    const readiness = new Readiness();
    readiness.set('configuration', DEPENDENCY_STATE.READY);
    readiness.set('database', DEPENDENCY_STATE.READY);
    // B4 resumeStorage and B6 notifications remain not_implemented.
    expect(readiness.isReady()).toBe(false);
    const states = Object.fromEntries(readiness.describe().dependencies.map((d) => [d.name, d.state]));
    expect(states.resumeStorage).toBe('not_implemented');
    expect(states.notifications).toBe('not_implemented');
  });
});

describe('connection listeners do not accumulate', () => {
  it('registers one listener per event even when connect runs twice in a process', async () => {
    const instance = fakeMongoose();
    const config = loadConfig(baseEnv);
    await connectDatabase({ config, logger: capturing().logger, readiness: new Readiness(), mongooseInstance: instance });
    const second = new Readiness();
    await connectDatabase({ config, logger: capturing().logger, readiness: second, mongooseInstance: instance });

    ['connected', 'disconnected', 'error'].forEach((event) =>
      expect(instance.connection.listenerCount(event), event).toBe(1),
    );
    // And the surviving listeners report into the CURRENT readiness registry.
    instance.connection.emit('disconnected');
    expect(second.describe().dependencies.find((d) => d.name === 'database').state).toBe('unavailable');
  });

  it('removes its listeners once the connection is closed', async () => {
    const instance = fakeMongoose();
    const readiness = new Readiness();
    await connectDatabase({ config: loadConfig(baseEnv), logger: capturing().logger, readiness, mongooseInstance: instance });
    await disconnectDatabase({ logger: capturing().logger, readiness, mongooseInstance: instance });
    ['connected', 'disconnected', 'error'].forEach((event) =>
      expect(instance.connection.listenerCount(event), event).toBe(0),
    );
  });

  it('passes the connect timeout and disables implicit index/collection creation', async () => {
    const instance = fakeMongoose();
    await connectDatabase({
      config: loadConfig({ ...baseEnv, MONGODB_CONNECT_TIMEOUT_MS: '2500' }),
      logger: capturing().logger,
      readiness: new Readiness(),
      mongooseInstance: instance,
    });
    expect(instance.lastConnectOptions).toEqual({ serverSelectionTimeoutMS: 2500, autoIndex: false, autoCreate: false });
  });
});

describe('the production connector', () => {
  it('is the real Mongoose connect/disconnect pair', () => {
    expect(mongoDatabase.connect).toBe(connectDatabase);
    expect(mongoDatabase.disconnect).toBe(disconnectDatabase);
    expect(Object.isFrozen(mongoDatabase)).toBe(true);
  });
});

describe('parseMongoUri (driver-aware; shared with the test-database guard)', () => {
  it('reports the explicit database name, or null when the URI names none', () => {
    expect(parseMongoUri('mongodb://db1.example,db2.example/valida_test?replicaSet=rs0')).toEqual({
      valid: true, databaseName: 'valida_test', isSrv: false, hostCount: 2,
    });
    expect(parseMongoUri('mongodb+srv://cluster0.example.net/valida')).toEqual({
      valid: true, databaseName: 'valida', isSrv: true, hostCount: 1,
    });
    // The driver itself would silently fall back to a database called "test".
    expect(parseMongoUri('mongodb://db.example').databaseName).toBeNull();
    expect(parseMongoUri('mongodb://db.example/').databaseName).toBeNull();
    expect(parseMongoUri('mongodb://db.example/?replicaSet=rs0').databaseName).toBeNull();
  });

  it('does not mistake a "/" inside the query for a database path', () => {
    expect(parseMongoUri('mongodb://db.example?appName=a%2Fb').databaseName).toBeNull();
  });

  it.each([undefined, null, 42, '', 'not a uri', 'mongodb://', 'mongodb://db.example/va%ZZlida'])(
    'returns only { valid: false } for %j',
    (value) => expect(parseMongoUri(value)).toEqual({ valid: false }),
  );
});
