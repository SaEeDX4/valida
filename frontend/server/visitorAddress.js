/**
 * The visitor's address, as the document server establishes it — C6-T2.
 *
 * ONE RULE FOR BOTH SERVICES. The API decides who may see Jobs (C6-T1). The
 * document server only establishes WHO is asking, and passes that on with
 * each of its Jobs reads. It must establish it exactly as the API would for a
 * direct request, or a document and the page rendered from it could disagree.
 * So it does not reimplement the rule: it uses the API's own module,
 * backend/src/config/recruitmentAccess.js, which depends on nothing but Node.
 *
 *   TRUST_PROXY=false  the socket's peer; X-Forwarded-For is not read.
 *   TRUST_PROXY=n      at least n X-Forwarded-For entries; the client is the
 *                      entry n from the right, and it and every entry to its
 *                      right must be plain addresses. Fewer entries, or none,
 *                      means the visitor is UNKNOWN — the unlisted view.
 *
 * A visitor cannot claim an address any other way: the document server never
 * reads, and never passes on, the X-Valida-* headers a request arrives with.
 *
 * DEPLOYMENT NOTE. This import crosses from frontend/ into backend/. Both
 * services are built from one commit of one repository (Doc 15; C6 plan
 * section 8.1), and the e2e stacks already import from backend/ in the same
 * way. A host that gives a service only its own sub-directory would break it:
 * that is checked on the review host before anything else (C6 plan, gate
 * G-ACCESS, H9).
 */
import {
  DELEGATION_HEADERS,
  UNLISTED_VISITOR,
  establishClientAddress,
  isUsableServiceKey,
  parseTrustedHops,
} from '../../backend/src/config/recruitmentAccess.js';

export { DELEGATION_HEADERS, UNLISTED_VISITOR, isUsableServiceKey, parseTrustedHops };

/**
 * The visitor's address for one request, or null when it cannot be
 * established. Null is sent as `unlisted`, and the API gives the public view.
 */
export function establishVisitorAddress(req, trustedHops) {
  try {
    return establishClientAddress({
      trustedHops,
      socketAddress: req?.socket?.remoteAddress,
      forwardedFor: req?.headers?.['x-forwarded-for'],
    });
  } catch {
    return null;
  }
}
