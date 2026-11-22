import mongoose from 'mongoose';
import { AuditEvent } from '../../models/AuditEvent.js';

/**
 * The audit writer — Doc 10 s147-153, Doc 11 s177, s198-203 (E1-E5).
 *
 * occurredAt is the server's clock (Doc 10 s153). Metadata must already be
 * minimal and safe; this writer additionally refuses keys that could carry a
 * secret or personal content, so a mistake elsewhere fails loudly in tests
 * instead of silently writing it.
 */

const FORBIDDEN_METADATA_KEYS = /pass|token|secret|code|otp|cookie|csrf|body|message|email|name|phone|resume|file/i;
const ALLOWED_METADATA_KEYS = new Set(['fromStatus', 'toStatus', 'reasonProvided', 'roles', 'previousRoles', 'kind', 'direction', 'status', 'outcome', 'scanStatus', 'transition', 'fields', 'material', 'targetAdminId', 'sessionPublicId', 'count', 'method', 'slug', 'channel', 'lockedUntil']);

function cleanMetadata(metadata = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key) || (FORBIDDEN_METADATA_KEYS.test(key) && key !== 'reasonProvided')) {
      throw new Error(`audit metadata key "${key}" is not permitted`);
    }
    clean[key] = value;
  }
  return clean;
}

const toObjectId = (value) => (value === null || value === undefined ? null : new mongoose.Types.ObjectId(String(value)));

export function createAuditWriter({ model = AuditEvent, clock = () => new Date(), logger } = {}) {
  return Object.freeze({
    /**
     * @param {{ actor: { type: 'ADMIN'|'SYSTEM', id?: any }, action: string, resource: { type: string, id?: any }, requestId?: string, metadata?: object }} event
     */
    async record({ actor, action, resource, requestId = null, metadata = {} }) {
      const event = new model({
        actor: { type: actor.type, id: toObjectId(actor.id) },
        action,
        resource: { type: resource.type, id: toObjectId(resource.id) },
        requestId,
        metadata: cleanMetadata(metadata),
        occurredAt: clock(),
      });
      await event.save();
      logger?.info?.({ event: 'audit.recorded', action, resourceType: resource.type, requestId }, 'audit event recorded');
      return event;
    },
  });
}
