import { Currency, formatMoney, toMinorUnits } from '@fincore/contracts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatInrMinor(amountMinor: number | string | null | undefined): string {
  const num = Number(amountMinor ?? 0);
  return formatMoney(Number.isFinite(num) ? num : 0, Currency.INR);
}

export function parseMajorToMinor(majorInput: string): number {
  return toMinorUnits(majorInput, Currency.INR);
}

/** Mask wallet/account UUIDs in customer-facing views while keeping tail searchable. */
export function maskIdentifier(id: string | null | undefined, visibleTail = 6): string {
  if (!id) return '—';
  if (id.length <= visibleTail + 4) return id;
  return `${id.slice(0, 4)}••••${id.slice(-visibleTail)}`;
}

export function formatUtcTimestamp(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  const date = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
