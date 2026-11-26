import { z } from 'zod';
import { Currency, CURRENCY_CONFIG } from './enums.js';

/**
 * Money schema — amounts are always in integer minor units (e.g., paise for INR).
 * Currency is mandatory on every monetary value.
 *
 * Design decision (see docs/ASSUMPTIONS.md A1):
 * - Storage: BIGINT in PostgreSQL
 * - TypeScript: number (safe integer range, max ~9 quadrillion paise)
 * - Python: Decimal for calculations, int for storage
 * - Display: divided by 10^minorDigits with currency symbol
 */
export const MoneySchema = z.object({
  amountMinor: z.number().int().min(0, 'Amount must be non-negative'),
  currency: z.nativeEnum(Currency),
});
export type Money = z.infer<typeof MoneySchema>;

/**
 * Format integer minor units (e.g. paise) as exact decimal string without binary float arithmetic.
 * Example: 150075 INR -> "1500.75", -50 -> "-0.50"
 */
export function minorToDecimalString(minorAmount: number | bigint, currency: Currency): string {
  const cfg = CURRENCY_CONFIG[currency];
  const scale = cfg.minorDigits;
  const raw = typeof minorAmount === 'bigint' ? minorAmount : BigInt(Math.trunc(minorAmount));
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const factor = 10n ** BigInt(scale);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Format minor units to display string.
 * Example: 150075 INR → "₹1,500.75"
 */
export function formatMoney(amountMinor: number, currency: Currency): string {
  const config = CURRENCY_CONFIG[currency];
  const decimalStr = minorToDecimalString(amountMinor, currency);
  const [intPart = '0', fracPart = ''] = decimalStr.replace('-', '').split('.');
  const formattedInt = BigInt(intPart).toLocaleString('en-IN');
  const sign = amountMinor < 0 ? '-' : '';
  return `${sign}${config.symbol}${formattedInt}${config.minorDigits > 0 ? `.${fracPart}` : ''}`;
}

/**
 * Convert major units string or finite number to integer minor units via exact decimal string parsing.
 * Avoids binary floating-point multiplication errors and rejects excess fractional precision.
 */
export function toMinorUnits(majorAmount: number | string, currency: Currency): number {
  const config = CURRENCY_CONFIG[currency];
  let normalized: string;
  if (typeof majorAmount === 'string') {
    normalized = majorAmount.trim();
  } else {
    if (!Number.isFinite(majorAmount)) {
      throw new Error(`Invalid monetary number: ${majorAmount}`);
    }
    normalized = majorAmount.toFixed(config.minorDigits);
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid monetary amount: ${majorAmount}`);
  }

  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', frac = ''] = unsigned.split('.');
  if (frac.length > config.minorDigits) {
    throw new Error(
      `Precision exceeds ${config.minorDigits} decimal places for ${currency}: ${majorAmount}`,
    );
  }

  const padded = frac.padEnd(config.minorDigits, '0');
  const combined = BigInt(`${whole}${padded}`);
  const signed = negative ? -combined : combined;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Monetary amount exceeds safe integer range: ${majorAmount}`);
  }
  return Number(signed);
}

/**
 * Convert minor units to major units for display via exact decimal string formatting.
 */
export function toMajorUnits(minorAmount: number, currency: Currency): number {
  return Number(minorToDecimalString(minorAmount, currency));
}
