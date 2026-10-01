/**
 * Readiness state — 09_BACKEND_API_SPEC.md, 15_DEVOPS_DEPLOYMENT.md.
 *
 * Canonical readiness requires configuration validated, MongoDB connected, the
 * private resume storage adapter initialised and the transactional email
 * integration configured.
 *
 * B1 implemented configuration and B2 the database (set from the real
 * connection events in db/mongoose.js). B4 sets resumeStorage from the real
 * outcome of the storage initialisation in server.js: `ready` only after the
 * configured storage wrote, read back and removed a probe object;
 * `unavailable` (local) or `not_implemented` (deployed; the production
 * provider is selected at C6) when no storage is configured. Notifications
 * (B6) do not exist yet — so that dependency is registered as REQUIRED and
 * left `not_implemented` rather than omitted. Omitting it would make the
 * service report itself ready while a required dependency is absent, which is
 * exactly the false success this project forbids. A B4 runtime therefore
 * answers 503 on /health/ready, truthfully, even with MongoDB connected and
 * storage ready.
 *
 * Each milestone flips its own dependency to ready when it genuinely
 * connects: B6 notifications is the one remaining.
 */

export const DEPENDENCY_STATE = {
  READY: 'ready',
  PENDING: 'pending',
  UNAVAILABLE: 'unavailable',
  NOT_IMPLEMENTED: 'not_implemented',
};

/** Dependencies canonical readiness requires, and the milestone that owns each. */
const CANONICAL_DEPENDENCIES = [
  { name: 'configuration', owner: 'B1' },
  { name: 'database', owner: 'B2' },
  { name: 'resumeStorage', owner: 'B4' },
  { name: 'notifications', owner: 'B6' },
];

export class Readiness {
  #dependencies = new Map();
  #shuttingDown = false;

  constructor() {
    for (const { name, owner } of CANONICAL_DEPENDENCIES) {
      this.#dependencies.set(name, {
        name,
        owner,
        required: true,
        state: DEPENDENCY_STATE.NOT_IMPLEMENTED,
      });
    }
  }

  /** Records the state of one dependency. Used by each milestone's startup. */
  set(name, state) {
    const existing = this.#dependencies.get(name);
    if (!existing) {
      throw new Error(`Unknown readiness dependency: ${name}`);
    }
    if (!Object.values(DEPENDENCY_STATE).includes(state)) {
      throw new Error(`Unknown readiness state: ${state}`);
    }
    this.#dependencies.set(name, { ...existing, state });
  }

  /**
   * Marks the process as draining. Called first during graceful shutdown so a
   * load balancer stops sending new traffic before the server closes.
   */
  beginShutdown() {
    this.#shuttingDown = true;
  }

  get isShuttingDown() {
    return this.#shuttingDown;
  }

  isReady() {
    if (this.#shuttingDown) return false;
    return [...this.#dependencies.values()].every(
      (dependency) => !dependency.required || dependency.state === DEPENDENCY_STATE.READY,
    );
  }

  /**
   * Full state — for INTERNAL LOGGING ONLY.
   *
   * Never returned in a public response body: naming the failing dependency
   * tells an unauthenticated caller which part of the infrastructure is down.
   */
  describe() {
    return {
      ready: this.isReady(),
      shuttingDown: this.#shuttingDown,
      dependencies: [...this.#dependencies.values()].map(({ name, owner, required, state }) => ({
        name,
        owner,
        required,
        state,
      })),
    };
  }

  /** Test helper: a fully ready state, without pretending in production. */
  static fullyReadyForTests() {
    const readiness = new Readiness();
    for (const { name } of CANONICAL_DEPENDENCIES) {
      readiness.set(name, DEPENDENCY_STATE.READY);
    }
    return readiness;
  }
}
