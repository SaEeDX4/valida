/**
 * Money conversion for public DTOs — 10_DATA_MODEL.md sections 13-15,
 * 09_BACKEND_API_SPEC.md section 185.
 *
 * The database stores exact integer MINOR units (CAD 35.00 -> 3500). The
 * public DTO carries the major-unit amount as a number (35). Converting
 * correctly requires the currency's ISO 4217 minor-unit exponent: dividing by
 * 100 is right for CAD, but would publish a wage 100 times too small in JPY
 * (exponent 0) and 10 times too large in KWD (exponent 3).
 *
 * The exponent therefore comes from this EXPLICIT table, never from a guess.
 * It lists only the currency the canonical documents establish for Valida's
 * planned role (CAD — Doc 10 section 70, Doc 12 section 44). A wage is a
 * recruitment-truth field (Doc 02), so an unlisted currency is not converted
 * with an assumed exponent: provisioning refuses it and the public mapper
 * fails closed. Supporting another currency is a one-line, reviewed addition
 * here with its ISO 4217 exponent and a test.
 *
 * Runtime locale data (Intl / CLDR) is deliberately not used: CLDR's display
 * digits differ from ISO 4217 minor units for several currencies.
 */

/** ISO 4217 minor-unit exponent for each supported currency. */
export const CURRENCY_MINOR_UNIT_EXPONENTS = Object.freeze({
  CAD: 2,
});

export const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(CURRENCY_MINOR_UNIT_EXPONENTS));

export function isSupportedCurrency(currency) {
  return typeof currency === 'string' && Object.hasOwn(CURRENCY_MINOR_UNIT_EXPONENTS, currency);
}

/** Raised when an amount cannot be converted exactly. Carries no amount. */
export class MoneyConversionError extends Error {
  constructor(reason) {
    super(`money conversion refused: ${reason}`);
    this.name = 'MoneyConversionError';
    this.reason = reason;
  }
}

/**
 * Converts integer minor units to the major-unit number used by the DTO.
 *
 * For a safe integer n and exponent e, n / 10^e is the IEEE double nearest the
 * exact decimal value, and JSON serialises it in its shortest round-trip form,
 * so 3500 -> 35, 3550 -> 35.5 and 3599 -> 35.99 exactly as written.
 *
 * @throws {MoneyConversionError} for an unsupported currency or a value that
 *   is not a non-negative safe integer.
 */
export function minorToMajor(amountMinor, currency) {
  if (!isSupportedCurrency(currency)) throw new MoneyConversionError('unsupported_currency');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new MoneyConversionError('invalid_minor_amount');
  }
  return amountMinor / 10 ** CURRENCY_MINOR_UNIT_EXPONENTS[currency];
}
