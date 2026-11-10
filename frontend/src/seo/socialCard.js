/**
 * The site's default social card (Open Graph image).
 *
 * Revision 2 (OD-2026-11-09-03), replacing revision 1 of OD-2026-11-09-02:
 * the text group is moved up (logo-to-eyebrow gap 80 CSS px, was 125.8 px)
 * and the visible description is the approved social-sharing copy. Final
 * visual sign-off stays with the owner.
 *
 * Doc 16 sections 94-97: important public routes carry og:image and
 * og:image:alt; the default branded card is 1200 x 630; it must stay brand
 * appropriate. The image is the exact rendered file:
 *
 *   frontend/public/social/valida-social-card-v2-1200x630.png
 *   SHA-256 c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5
 *
 * served unchanged from that path (public/ files are copied into the build as
 * they are, with no content hash in the name). A revised image gets a new
 * file name, so a URL never changes meaning. Revision 1
 * (SHA-256 2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a)
 * is no longer served; it stays in docs/brand/social-card-preview/.
 *
 * The absolute og:image URL is built on the approved canonical origin only
 * (siteConfig.js), so a review build, which has no Open Graph at all, never
 * references it.
 */
export const SOCIAL_CARD = Object.freeze({
  path: '/social/valida-social-card-v2-1200x630.png',
  width: 1200,
  height: 630,
  sha256: 'c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5',
  /** The approved alternative text, exactly as written in OD-2026-11-09-03. */
  alt: 'Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a technology company focused on cybersecurity, secure technology, and security engineering."',
});
