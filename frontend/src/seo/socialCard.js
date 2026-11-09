/**
 * The site's default social card (Open Graph image) — owner decision
 * OD-2026-11-09-02, which approves the integration of the card reviewed under
 * OD-2026-11-09-01 (R5). Final visual sign-off stays with the owner.
 *
 * Doc 16 sections 94-97: important public routes carry og:image and
 * og:image:alt; the default branded card is 1200 x 630; it must stay brand
 * appropriate. The image is the exact approved file:
 *
 *   frontend/public/social/valida-social-card-1200x630.png
 *   SHA-256 2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a
 *
 * served unchanged from that stable path (public/ files are copied into the
 * build as they are, with no content hash in the name). The absolute og:image
 * URL is built on the approved canonical origin only (siteConfig.js), so a
 * review build, which has no Open Graph at all, never references it.
 */
export const SOCIAL_CARD = Object.freeze({
  path: '/social/valida-social-card-1200x630.png',
  width: 1200,
  height: 630,
  sha256: '2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a',
  /** The approved alternative text, exactly as written in OD-2026-11-09-02. */
  alt: 'Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering."',
});
