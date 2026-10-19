import { useEffect, useState } from "react";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number) => gbp.format(n);

/** Splits £1,234.50 into ["£1,234", ".50"] so decimals can be de-emphasised. */
export function moneyParts(n: number): [string, string] {
  const [whole, dec] = gbp2.format(n).split(".");
  return [`£${whole}`, `.${dec}`];
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric" });

/** Date-only strings ("2026-11-04") are calendar days, not UTC instants. */
export function parseDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function dateRange(from?: string, to?: string) {
  if (!from || !to) return undefined;
  const a = parseDay(from);
  const b = parseDay(to);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${sameMonth ? dayOnly.format(a) : dayMonth.format(a)}–${dayMonth.format(b)}`;
}

export function shortDate(iso?: string) {
  return iso ? dayMonth.format(parseDay(iso)) : "";
}

export function nightsBetween(from?: string, to?: string) {
  if (!from || !to) return undefined;
  const ms = parseDay(to).getTime() - parseDay(from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function relativeTime(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return shortDate(iso);
}

/** Re-renders on an interval so relative times stay honest. */
export function useNow(intervalMs = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const firstName = (name?: string) => name?.split(" ")[0] ?? "";

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Stable, muted hue per person so avatars are distinguishable but quiet. */
export function hueFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
