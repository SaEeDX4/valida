import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecipientSuppression, RecipientSuppressionKey } from '../src/models/RecipientSuppression.js';
import { Application } from '../src/models/Application.js';

/**
 * B7 r3 review (finding 4) — SUP-6 "the entry is listed in the inventory".
 * A drift check: every field the two suppression models store is named in
 * docs/privacy/DATA_INVENTORY.md, and every undecided production input is
 * marked AWAITING. Offline; reads the schemas, never a database.
 */
const INVENTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/privacy/DATA_INVENTORY.md');
const text = fs.readFileSync(INVENTORY, 'utf8');
const section = (heading) => {
  const start = text.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const next = text.indexOf('\n### ', start + heading.length);
  return text.slice(start, next === -1 ? text.indexOf('\n## ', start + heading.length) : next);
};
/** Every stored field name: top-level paths (dotted as written) and the fields of embedded arrays. */
const storedFields = (model) => {
  const names = new Set();
  for (const [name, type] of Object.entries(model.schema.paths)) {
    if (name === '__v') continue;
    names.add(name);
    if (type.schema) for (const inner of Object.keys(type.schema.paths)) if (inner !== '_id') names.add(inner);
  }
  return [...names];
};

describe('SUP-6 — the suppression data-inventory entry (docs/privacy/DATA_INVENTORY.md)', () => {
  it.each([
    ['### 1.1', RecipientSuppression],
    ['### 1.2', RecipientSuppressionKey],
  ])('%s names the collection and every field it stores', (heading, model) => {
    const body = section(heading);
    expect(body).toContain(`\`${model.collection.collectionName}\``);
    const missing = storedFields(model).filter((name) => !body.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('§1.3 names the Application channel field lastStatusCode with its stored pattern', () => {
    const body = section('### 1.3');
    expect(Application.schema.path('notifications.candidateAcknowledgement.lastStatusCode')).toBeDefined();
    expect(body).toContain('`lastStatusCode`');
    expect(body).toContain('^[245]\\.\\d{1,3}\\.\\d{1,3}$');
  });

  it('every undecided production input is marked AWAITING — nothing is invented', () => {
    for (const [heading, marker] of [
      ['### 1.1', /Production MongoDB hosting provider and region: AWAITING INPUT/],
      ['### 1.1', /Provider, contractual \/ privacy role, transfers[^\n]*\*\*AWAITING INPUT\*\*/],
      ['### 1.1', /Production operator tokens: AWAITING INPUT/],
      ['### 1.1', /AWAITING PRIVACY \/ LEGAL \/ OPERATIONAL DETERMINATION/],
      ['### 1.1', /reconciliation of deleted entries[^\n]*AWAITING INPUT/],
      ['### 1.4', /protected second copy[^\n]*location: AWAITING INPUT/],
      ['### 1.5', /production log provider and retention: AWAITING INPUT/],
    ]) {
      expect(section(heading)).toMatch(marker);
    }
    expect(text).toMatch(/Privacy Notice description[^\n]*AWAITING INPUT/);
  });

  it('holds no address, digest or key-like value', () => {
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(text).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
  });
});
