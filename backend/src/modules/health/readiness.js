/**
 * Readiness state — 09_BACKEND_API_SPEC.md, 15_DEVOPS_DEPLOYMENT.md.
 *
 * Canonical readiness requires configuration validated, MongoDB connected, the
 * private resume storage adapter initialised and the transactional email
 * integration configured.
 *
 * B1 implements only the first. The rest do not exist yet — so they are
 * registered as REQUIRED and left in the `not_implemented` state rather than
 * omitted. Omitting them would make the service report itself ready while
 * three required dependencies are absent, which is exactly the false success
 * this project forbids. A B1 runtime therefore answers 503 on /health/ready,
 * truthfully.
 *
 * Each later milestone flips its own dependency to ready when it genuinely
 * connects: B2 database, B4 resumeStorage, B6 notifications.
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
