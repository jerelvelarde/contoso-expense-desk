import "@fontsource-variable/instrument-sans";
import "@fontsource/instrument-serif/400.css";
import "@fontsource-variable/jetbrains-mono";
import { continueRender, delayRender } from "remotion";
import timeline from "./timeline.json";

/** Every number in the film comes from timeline.json, written by plan.py from the capture. */
export const T = timeline;
export type Rect = { x: number; y: number; w: number; h: number };

const fontsHandle = delayRender("Loading fonts");
Promise.all([
  document.fonts.load('600 52px "Instrument Sans Variable"'),
  document.fonts.load('400 13px "Instrument Sans Variable"'),
  document.fonts.load('400 40px "Instrument Serif"'),
  document.fonts.load('500 13px "JetBrains Mono Variable"'),
]).then(() => continueRender(fontsHandle));

export const C = {
  canvas: "#f5f6f8",
  surface: "#ffffff",
  sunken: "#eef0f3",
  line: "#e5e7eb",
  lineStrong: "#d1d5db",
  ink: "#16171a",
  ink2: "#474a52",
  ink3: "#676a72",
  accent: "#0f6cbd",
  accentWash: "#ebf3fc",
  wait: "#9a5400",
  ok: "#17784a",
  okWash: "#e7f3ec",
  learn: "#0b6a80",
  learnWash: "#e6f3f5",
  teams: "#5b5fc7",
};
export const SANS = '"Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif';
export const SERIF = '"Instrument Serif", Georgia, serif';
export const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';
export const TEAMS_FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** 0 → 1 between t0 and t1 seconds, eased. */
export const ramp = (t: number, t0: number, t1: number, ease = easeInOut) => ease(clamp((t - t0) / (t1 - t0)));
/** Fade in at t0, fade out at t1. */
export const window01 = (t: number, t0: number, t1: number, fade = 0.35) => Math.min(ramp(t, t0, t0 + fade), 1 - ramp(t, t1 - fade, t1));
