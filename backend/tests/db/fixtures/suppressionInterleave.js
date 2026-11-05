import { RecipientSuppression, RecipientSuppressionKey } from '../../../src/models/RecipientSuppression.js';
import { createSuppressionRegister } from '../../../src/modules/suppression/suppressionRegister.js';

/**
 * B7 SUP-24 — a deterministic interleaving seam for the REAL send-path read.
 *
 * The sender's register is the production `createSuppressionRegister`, given
 * model wrappers (its existing `models` option) that only DELAY the start of
 * the real MongoDB queries the send path issues, so that they run in a fixed
 * order and `between` runs exactly once, exactly between them:
 *
 *   coverage-first  the coverage queries (distinct key ids, key documents)
 *                   complete → `between` → the match query executes
 *   match-first     the match query completes → `between` → the coverage
 *                   queries execute
 *
 * Every other query (including any validation read the register makes before
 * or after) passes through unchanged and is recorded in `probe.order`. Nothing
 * is mocked: every query runs against the disposable database.
 */
export function steeredRegister({ order, between, probe = {}, timeoutMs = 15_000 }) {
  probe.order = [];
  probe.ran = false;
  probe.error = null;
  let coverageLeft = 2;
  let resolveCoverage;
  const coverageDone = new Promise((resolve) => {
    resolveCoverage = resolve;
  });
  let resolveMatchPhase;
  const matchPhase = new Promise((resolve) => {
    resolveMatchPhase = resolve;
  });
  let fired = false;
  const runBetween = async () => {
    if (fired) return;
    fired = true;
    probe.ran = true;
    probe.order.push('between');
    try {
      await between();
    } catch (error) {
      probe.error = error; // asserted by the test: a failing step must never look like a refusal
      throw error;
    }
  };

  const steer = (query, kind) => {
    const exec = query.exec.bind(query);
    query.exec = async (...args) => {
      if (kind === 'match' && order === 'coverage-first') {
        await coverageDone;
        await runBetween();
      }
      if (kind !== 'match' && order === 'match-first') await matchPhase;
      probe.order.push(kind);
      let result;
      try {
        result = await exec(...args);
        if (kind === 'coverage-ids') probe.coverageKeyIds = [...result].sort();
        if (kind === 'match') probe.matched = result !== null;
        return result;
      } finally {
        if (kind !== 'match') {
          coverageLeft -= 1;
          if (coverageLeft === 0) resolveCoverage();
        }
        if (kind === 'match' && order === 'match-first') {
          try {
            await runBetween();
          } finally {
            resolveMatchPhase();
          }
        }
      }
    };
    return query;
  };
  const record = (query, kind) => {
    const exec = query.exec.bind(query);
    query.exec = async (...args) => {
      probe.order.push(kind);
      return exec(...args);
    };
    return query;
  };

  const wrap = (model, routes) =>
    new Proxy(model, {
      get(target, property) {
        if (Object.hasOwn(routes, property)) return routes[property];
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const models = {
    RecipientSuppression: wrap(RecipientSuppression, {
      distinct: (...args) => steer(RecipientSuppression.distinct(...args), 'coverage-ids'),
      findOne: (filter, ...rest) => {
        const query = RecipientSuppression.findOne(filter, ...rest);
        return filter && Object.hasOwn(filter, '$or') ? steer(query, 'match') : record(query, 'other-read');
      },
    }),
    RecipientSuppressionKey: wrap(RecipientSuppressionKey, {
      find: (...args) => steer(RecipientSuppressionKey.find(...args), 'coverage-keys'),
    }),
  };
  return createSuppressionRegister({ timeoutMs, writeTimeoutMs: timeoutMs, models });
}
