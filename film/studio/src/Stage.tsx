import { Freeze, Img, OffthreadVideo, Sequence, staticFile, useVideoConfig } from "remotion";
import { C, SANS, TEAMS_FONT, T, clamp, easeOut, lerp, ramp, type Rect } from "./lib";

/* ------------------------------------------------------------------ */
/* Expense Desk: the real capture, cut by the timeline's segments.     */
/* ------------------------------------------------------------------ */

export function Desk({ t }: { t: number }) {
  const { fps } = useVideoConfig();
  const d = T.layout.desk as Rect;
  const shown = ramp(t, 6.2, 7.4);
  const glow = pulseGlow(t, "desk");
  return (
    <div
      style={{
        position: "absolute", left: d.x, top: d.y, width: d.w, height: d.h, borderRadius: 16, overflow: "hidden",
        background: C.canvas, opacity: shown, transform: `translateX(${(1 - shown) * 60}px)`,
        boxShadow: `0 30px 80px -30px rgb(22 23 26 / 0.35), 0 0 0 1px rgb(22 23 26 / 0.06), 0 0 0 ${glow * 4}px rgb(15 108 189 / ${glow * 0.35})`,
      }}
    >
      {T.desk.segments.map((s, i) => {
        const from = Math.round(s.f0 * fps);
        const dur = Math.max(1, Math.round(s.f1 * fps) - from);
        const trim = Math.round(s.c0 * fps);
        const video = (
          <OffthreadVideo src={staticFile(T.desk.src)} trimBefore={trim} playbackRate={s.rate || 1} muted style={{ width: d.w, height: d.h, display: "block" }} />
        );
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            {s.rate === 0 ? <Freeze frame={0}>{video}</Freeze> : video}
          </Sequence>
        );
      })}
    </div>
  );
}

export function SpeedChip({ t }: { t: number }) {
  const c = T.desk.speedChip;
  const o = Math.min(ramp(t, c.f0, c.f0 + 0.25), 1 - ramp(t, c.f1 - 0.2, c.f1 + 0.05));
  if (o <= 0) return null;
  // Screen space (outside the camera), so a push-in never hides it.
  return (
    <div style={{ position: "absolute", right: 72, top: 78, opacity: o, padding: "7px 14px", borderRadius: 999, background: "rgb(22 23 26 / 0.8)", color: "#fff", font: `500 20px ${SANS}`, letterSpacing: "0.01em" }}>
      {c.label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teams: a plain chat frame; cards are real Adaptive Card SDK renders. */
/* ------------------------------------------------------------------ */

type CardRef = { src: string; w: number; h: number };
type TeamsEvent = { t: number; until?: number; panel: string; kind: string; text?: string; card?: CardRef; id?: string };
const EVENTS = T.teams as TeamsEvent[];

function BotAvatar({ size = 26 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 6, background: C.teams, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" fill="#fff" />
        <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke={C.teams} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function enter(t: number, at: number) {
  const p = easeOut(clamp((t - at) / 0.35));
  return { opacity: p, transform: `translateY(${(1 - p) * 14}px)` };
}

function Thinking({ t }: { t: number }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <BotAvatar />
      <div style={{ background: "#f0f0f0", borderRadius: 10, padding: "10px 12px", display: "flex", gap: 4 }}>
        {[0, 1, 2].map((i) => {
          const phase = (t * 2.2 - i * 0.18) % 1;
          const up = Math.sin(clamp(phase) * Math.PI);
          return <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: "#8a8886", opacity: 0.45 + up * 0.55, transform: `translateY(${-up * 2.5}px)` }} />;
        })}
      </div>
    </div>
  );
}

function CardMessage({ t, card, swaps }: { t: number; card: CardRef; swaps: TeamsEvent[] }) {
  const cw = T.cardW;
  const current = swaps.filter((s) => s.t <= t).at(-1);
  const shown = current?.card ?? card;
  const flash = current ? 1 - clamp((t - current.t) / 1.1) : 0;
  const ring = current?.card?.src.includes("decided") ? "23 120 74" : "15 108 189";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <BotAvatar />
      <div style={{ display: "grid", gap: 4 }}>
        <span style={{ font: `600 12px ${TEAMS_FONT}`, color: "#424242" }}>Expenses</span>
        <Img
          src={staticFile(shown.src)}
          style={{ width: cw, height: (cw * shown.h) / shown.w, display: "block", borderRadius: 8, boxShadow: `0 0 0 ${flash * 5}px rgb(${ring} / ${flash * 0.45})` }}
        />
      </div>
    </div>
  );
}

export function TeamsPanel({ t, who }: { t: number; who: "amara" | "jonas" }) {
  const r = T.layout[who] as Rect;
  const mine = EVENTS.filter((e) => e.panel === who);
  const swaps = mine.filter((e) => e.kind === "swap");
  const visible = mine.filter((e) => e.kind !== "swap" && e.t <= t && !(e.kind === "thinking" && t >= (e.until ?? 0)));
  const shown = who === "amara" ? 1 : ramp(t, 6.6, 7.6);
  const glow = pulseGlow(t, who);
  const typing = who === "amara" ? (T.typing as { start: number; end: number; text: string }[]).find((k) => t >= k.start - 0.4 && t < k.end + 0.45) : undefined;
  const typed = typing ? typing.text.slice(0, Math.floor(clamp((t - typing.start) / (typing.end - typing.start)) * typing.text.length)) : "";
  const composerH = who === "amara" ? 54 : 0;
  const name = who === "amara" ? "Amara Nwosu" : "Jonas Lindqvist";

  return (
    <div
      style={{
        position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 16, background: "#fff", overflow: "hidden",
        opacity: shown, fontFamily: TEAMS_FONT,
        boxShadow: `0 24px 60px -28px rgb(22 23 26 / 0.32), 0 0 0 1px rgb(22 23 26 / 0.07), 0 0 0 ${glow * 4}px rgb(15 108 189 / ${glow * 0.35})`,
      }}
    >
      <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: "1px solid #edebe9" }}>
        <BotAvatar size={24} />
        <span style={{ font: `600 14px ${TEAMS_FONT}`, color: "#242424" }}>Expenses</span>
        <span style={{ font: `400 12px ${TEAMS_FONT}`, color: "#616161" }}>in {name}'s Teams</span>
      </div>
      <div style={{ position: "absolute", left: 14, right: 14, top: 46, bottom: composerH + 8, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, overflow: "hidden", paddingBottom: 6 }}>
        {visible.length === 0 ? (
          <div style={{ alignSelf: "center", margin: "auto", font: `400 13px ${TEAMS_FONT}`, color: "#8a8886" }}>Ask Expenses about travel and spending</div>
        ) : null}
        {visible.map((e, i) => (
          <div key={i} style={{ ...enter(t, e.t), display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {e.kind === "user" ? (
              <div style={{ alignSelf: "flex-end", maxWidth: 340, background: "#e8ebfa", color: "#242424", borderRadius: 10, padding: "8px 11px", font: `400 13.5px/1.4 ${TEAMS_FONT}` }}>{e.text}</div>
            ) : e.kind === "bot" ? (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <BotAvatar />
                <div style={{ maxWidth: 380, background: "#f5f5f5", color: "#242424", borderRadius: 10, padding: "8px 11px", font: `400 13.5px/1.4 ${TEAMS_FONT}` }}>{e.text}</div>
              </div>
            ) : e.kind === "thinking" ? (
              <Thinking t={t} />
            ) : e.card ? (
              <CardMessage t={t} card={e.card} swaps={swaps.filter((s) => s.id === e.id)} />
            ) : null}
          </div>
        ))}
      </div>
      {who === "amara" ? (
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 12, height: 40, borderRadius: 8, border: `1px solid ${typing ? "#5b5fc7" : "#e0e0e0"}`, display: "flex", alignItems: "center", padding: "0 12px", font: `400 13.5px ${TEAMS_FONT}`, color: typed ? "#242424" : "#8a8886", overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ overflow: "hidden", textOverflow: "clip", direction: "rtl", textAlign: "left", flex: 1 }}>
            <bdi>{typed || "Type a message"}</bdi>
          </span>
          {typing && Math.floor(t * 2) % 2 === 0 ? <span style={{ width: 1.5, height: 17, background: "#242424", marginLeft: 1 }} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The line between the two screens, and the pulse that travels on it. */
/* ------------------------------------------------------------------ */

type Pulse = { t: number; from: string; to: string };
const PULSES = T.pulses as Pulse[];
const TRAVEL = 0.5;

function anchors() {
  const a = T.layout.amara as Rect, j = T.layout.jonas as Rect, d = T.layout.desk as Rect;
  return {
    amara: { x: a.x + a.w, y: a.y + a.h * 0.55 },
    jonas: { x: j.x + j.w, y: j.y + j.h * 0.45 },
    deskA: { x: d.x, y: d.y + d.h * 0.32 },
    deskJ: { x: d.x, y: d.y + d.h * 0.7 },
  };
}

function curve(p0: { x: number; y: number }, p1: { x: number; y: number }) {
  const mx = (p0.x + p1.x) / 2;
  return { p0, c0: { x: mx, y: p0.y }, c1: { x: mx, y: p1.y }, p1 };
}

function bez(c: ReturnType<typeof curve>, u: number) {
  const v = 1 - u;
  const x = v * v * v * c.p0.x + 3 * v * v * u * c.c0.x + 3 * v * u * u * c.c1.x + u * u * u * c.p1.x;
  const y = v * v * v * c.p0.y + 3 * v * v * u * c.c0.y + 3 * v * u * u * c.c1.y + u * u * u * c.p1.y;
  return { x, y };
}

/** How strongly a surface glows because a pulse just reached it. */
export function pulseGlow(t: number, who: string) {
  let g = 0;
  for (const p of PULSES) {
    if (p.to !== who) continue;
    const arrive = p.t + TRAVEL;
    if (t >= arrive) g = Math.max(g, 1 - clamp((t - arrive) / 0.7));
  }
  return g;
}

export function Wire({ t }: { t: number }) {
  const A = anchors();
  const lines = { amara: curve(A.amara, A.deskA), jonas: curve(A.jonas, A.deskJ) };
  const shown = ramp(t, 7.0, 8.0);
  if (shown <= 0) return null;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: shown }}>
      {(["amara", "jonas"] as const).map((k) => {
        const c = lines[k];
        const active = PULSES.filter((p) => p.from === k || p.to === k).some((p) => t >= p.t - 0.1 && t <= p.t + TRAVEL + 0.5);
        const d = `M${c.p0.x},${c.p0.y} C${c.c0.x},${c.c0.y} ${c.c1.x},${c.c1.y} ${c.p1.x},${c.p1.y}`;
        return (
          <g key={k}>
            <path d={d} stroke={active ? C.accent : C.lineStrong} strokeOpacity={active ? 0.7 : 1} strokeWidth={2} fill="none" />
            <circle cx={c.p0.x} cy={c.p0.y} r={4} fill={C.surface} stroke={C.lineStrong} strokeWidth={1.5} />
            <circle cx={c.p1.x} cy={c.p1.y} r={4} fill={C.surface} stroke={C.lineStrong} strokeWidth={1.5} />
          </g>
        );
      })}
      {PULSES.map((p, i) => {
        const u = (t - p.t) / TRAVEL;
        if (u < 0 || u > 1) return null;
        const k = p.from === "desk" ? p.to : p.from;
        const c = lines[k as "amara" | "jonas"];
        const pos = bez(c, p.from === "desk" ? 1 - easeOut(u) : easeOut(u));
        return (
          <g key={i}>
            <circle cx={pos.x} cy={pos.y} r={14} fill={C.accent} opacity={0.18} />
            <circle cx={pos.x} cy={pos.y} r={6} fill={C.accent} />
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Cursor: drawn on a path, parks off to the side.                     */
/* ------------------------------------------------------------------ */

type CursorDef = { in: number; at: number; click: number; out: number; from: number[]; to: number[]; park: number[]; kind: string };

export function Cursors({ t }: { t: number }) {
  return (
    <>
      {(T.cursors as CursorDef[]).map((c, i) => {
        if (t < c.in || t > c.out + 0.8) return null;
        const go = ramp(t, c.in, c.at);
        const leave = ramp(t, c.out, c.out + 0.7);
        const x = leave > 0 ? lerp(c.to[0], c.park[0], leave) : lerp(c.from[0], c.to[0], go);
        const y = leave > 0 ? lerp(c.to[1], c.park[1], leave) : lerp(c.from[1], c.to[1], go) - Math.sin(go * Math.PI) * 30;
        const press = t >= c.click && t < c.click + 0.14 ? 0.86 : 1;
        const ring = clamp((t - c.click) / 0.45);
        const opacity = Math.min(ramp(t, c.in, c.in + 0.2), 1 - ramp(t, c.out + 0.5, c.out + 0.8));
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: 0, opacity }}>
            {t >= c.click && ring < 1 ? (
              <div style={{ position: "absolute", left: c.to[0] - 22 * ring - 6, top: c.to[1] - 22 * ring - 6, width: 12 + 44 * ring, height: 12 + 44 * ring, borderRadius: "50%", border: `2px solid ${c.kind === "approve" ? C.teams : C.accent}`, opacity: 1 - ring }} />
            ) : null}
            <svg width={26} height={30} viewBox="0 0 26 30" style={{ position: "absolute", left: x - 3, top: y - 2, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgb(0 0 0 / .25))" }}>
              <path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#fff" stroke="#16171a" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
        );
      })}
    </>
  );
}
