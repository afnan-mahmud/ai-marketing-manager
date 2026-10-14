/** Rounds a money amount to 2 decimals (keeps null). */
export function roundMoney(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/** Human formatting for summary lines, e.g. "BDT 1,234.50". */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null) return "n/a";
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: value % 1 === 0 ? 0 : 2 })}`;
}

export function formatPct(ratio: number | null, digits = 2): string {
  return ratio === null ? "n/a" : `${(ratio * 100).toFixed(digits)}%`;
}
