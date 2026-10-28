// Locale-aware formatting. Every number on screen goes through here so the
// two languages agree on precision.

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

export const DASH = "–";

export function count(n: number | null | undefined, locale: string): string {
  return n === null || n === undefined ? DASH : nf(locale, { maximumFractionDigits: 0 }).format(n);
}

/** 0.94432 -> "94.4%" (one decimal by default). */
export function percent(x: number | null | undefined, locale: string, digits = 1): string {
  if (x === null || x === undefined) return DASH;
  return nf(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

/** 11234 ms -> "11.2 s". */
export function seconds(ms: number | null | undefined, locale: string, digits = 1): string {
  if (ms === null || ms === undefined) return DASH;
  return `${nf(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ms / 1000)} s`;
}

export function decimal(x: number | null | undefined, locale: string, digits = 2): string {
  if (x === null || x === undefined) return DASH;
  return nf(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

/** "2026-10-20" -> "Oct 20" / "10월 20일". Plant days are dates, not instants. */
export function shortDay(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** An instant shown in the plant's time zone. */
export function dateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** Adds days to a plant date, staying in date arithmetic (no time zones). */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}
