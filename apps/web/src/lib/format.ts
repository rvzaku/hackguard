/** Display-only formatters. No business logic. */

export function formatMoneyMinor(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function shortHash(hex: string): string {
  return hex.slice(0, 10);
}

export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}
