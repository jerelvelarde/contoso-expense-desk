import { C, MONO, SANS, SERIF, T, clamp, easeOut, ramp } from "./lib";

/* ------------------------------------------------------------------ */
/* Headlines: masked slot rolls; line two lands with the answer.       */
/* ------------------------------------------------------------------ */

type Headline = { in: number; in2?: number; out: number; l1: string; l2?: string };
const ROLL = 0.47; // 14 frames

function Roll({ t, at, out, text, color }: { t: number; at: number; out: number; text: string; color: string }) {
  const inP = easeOut(clamp((t - at) / ROLL));
  const outP = easeOut(clamp((t - out) / ROLL));
  if (t < at || outP >= 1) return <div style={{ height: 60 }} />;
  const y = (1 - inP) * 100 - outP * 100;
  return (
    <div style={{ height: 60, overflow: "hidden" }}>
      <div style={{ transform: `translateY(${y}%)`, font: `600 52px/60px ${SANS}`, letterSpacing: "-0.02em", color, whiteSpace: "nowrap" }}>{text}</div>
    </div>
  );
}

export function Headlines({ t }: { t: number }) {
  const h = (T.headlines as Headline[]).find((x) => t >= x.in - 0.05 && t < x.out + ROLL + 0.1);
  const pos = T.layout.headline;
  return (
    <>
      {/* The stage fades under the copy when the camera pushes in. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 250, background: `linear-gradient(${C.canvas} 0%, ${C.canvas} 72%, rgb(245 246 248 / 0) 100%)` }} />
      {h ? (
        <div style={{ position: "absolute", left: pos.x, top: pos.y }}>
          <Roll t={t} at={h.in} out={h.out} text={h.l1} color={C.ink} />
          {h.l2 ? <Roll t={t} at={h.in2 ?? h.in} out={h.out + 0.08} text={h.l2} color={C.ink3} /> : null}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Learning montage: four approvals, drawn to scale, then the rule.    */
/* ------------------------------------------------------------------ */

type Stamp = { t: number; month: string; who: string; rate: number; id: string };

export function Montage({ t }: { t: number }) {
  const m = T.montage;
  const o = Math.min(ramp(t, m.in, m.in + 0.5), 1 - ramp(t, m.out - 0.6, m.out));
  if (o <= 0) return null;
  const chartH = 300;
  const max = 400;
  const y = (v: number) => chartH - (v / max) * chartH;
  const line = ramp(t, m.line[0], m.line[1]);
  const rule = ramp(t, m.rule, m.rule + 0.6);
  const colW = 170;
  const chartW = colW * 4;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <div style={{ position: "absolute", inset: 0, background: "rgb(245 246 248 / 0.94)" }} />
      <div style={{ position: "absolute", left: 960 - 470, top: 250, width: 940, display: "grid", justifyItems: "center", gap: 26 }}>
        <span style={{ opacity: ramp(t, m.chip, m.chip + 0.3), padding: "6px 14px", borderRadius: 999, background: C.learnWash, color: C.learn, font: `600 18px ${SANS}` }}>
          Four approvals later
        </span>
        <div style={{ position: "relative", width: chartW, height: chartH + 64 }}>
          {/* baseline */}
          <div style={{ position: "absolute", left: 0, right: 0, top: chartH, height: 1.5, background: C.lineStrong }} />
          {(m.stamps as Stamp[]).map((s, i) => {
            const p = easeOut(clamp((t - s.t) / 0.32));
            const h = (chartH - y(s.rate)) * p;
            const land = clamp((t - s.t) / 0.5);
            return (
              <div key={s.id} style={{ position: "absolute", left: i * colW + 30, width: colW - 60, top: 0, height: chartH + 64 }}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, height: h, borderRadius: "10px 10px 2px 2px", background: i === 3 ? C.ok : "#9fc9ad" }} />
                <div style={{ position: "absolute", left: -20, right: -20, bottom: 64 + h + 8, textAlign: "center", opacity: p, font: `600 26px ${SANS}`, color: C.ink, fontVariantNumeric: "tabular-nums" }}>£{s.rate}</div>
                <div style={{ position: "absolute", left: -24, right: -24, bottom: 0, height: 56, textAlign: "center", opacity: p, display: "grid", gap: 2 }}>
                  <span style={{ font: `600 15px ${SANS}`, color: C.ok }}>Approved</span>
                  <span style={{ font: `400 14px ${SANS}`, color: C.ink3 }}>{s.month} · {s.who.split(" ")[0]}</span>
                </div>
                {land > 0 && land < 1 ? (
                  <div style={{ position: "absolute", left: "50%", bottom: 64 + h, width: 90 * land + 10, height: 90 * land + 10, marginLeft: -(90 * land + 10) / 2, marginBottom: -(90 * land + 10) / 2, borderRadius: "50%", border: `2px solid ${C.ok}`, opacity: 1 - land }} />
                ) : null}
              </div>
            );
          })}
          {/* the learned limit, drawn at £350 on the same scale */}
          <div style={{ position: "absolute", left: 0, top: y(m.cap), width: chartW * line, borderTop: `2px dashed ${C.learn}` }} />
          <div style={{ position: "absolute", left: chartW + 14, top: y(m.cap) - 13, opacity: ramp(t, m.line[1] - 0.2, m.line[1] + 0.2), font: `600 18px ${SANS}`, color: C.learn, whiteSpace: "nowrap" }}>
            up to £{m.cap}
          </div>
        </div>
        <p style={{ margin: 0, opacity: rule, transform: `translateY(${(1 - rule) * 12}px)`, font: `400 44px/1.15 ${SERIF}`, color: C.ink, textAlign: "center" }}>
          London hotels are approved up to £{m.cap} a night.
        </p>
        <span style={{ opacity: rule, font: `500 15px ${MONO}`, color: C.ink3 }}>LR-01 · learned by CopilotKit Intelligence from 4 approvals by Jonas Lindqvist</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* End card.                                                           */
/* ------------------------------------------------------------------ */

export function EndCard({ t }: { t: number }) {
  const e = T.end;
  const wash = ramp(t, e.wash, e.wash + 0.6);
  if (wash <= 0) return null;
  const title = ramp(t, e.title, e.title + 0.6);
  const stack = ramp(t, e.stack, e.stack + 0.6);
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgb(245 246 248 / ${wash})` }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 430, display: "grid", justifyItems: "center", gap: 30 }}>
        <div style={{ opacity: title, transform: `translateY(${(1 - title) * 16}px)`, font: `600 76px ${SANS}`, letterSpacing: "-0.025em", color: C.ink }}>
          Build agents that <span style={{ color: C.learn }}>learn</span>.
        </div>
        <div style={{ opacity: stack, display: "flex", gap: 10 }}>
          {e.stack_items.map((s) => (
            <span key={s} style={{ padding: "7px 15px", borderRadius: 999, border: `1px solid ${C.lineStrong}`, background: C.surface, font: `500 19px ${SANS}`, color: C.ink2 }}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
