// Money is stored as integer minor units (paise). UI shows major units.

export const CURRENCIES: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function symbol(currency: string): string {
  return CURRENCIES[currency] ?? currency + " ";
}

// "100" or "100.50" (major units) -> integer minor units. Returns null if invalid.
export function toMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

// integer minor units -> "₹1,400" (no decimals when whole, else 2dp)
export function formatMoney(minor: number, currency = "INR"): string {
  const sign = minor < 0 ? "-" : "";
  const major = Math.abs(minor) / 100;
  const str = Number.isInteger(major)
    ? major.toLocaleString("en-IN")
    : major.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${symbol(currency)}${str}`;
}
