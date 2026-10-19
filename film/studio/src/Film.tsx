import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { C, T, easeInOut, lerp } from "./lib";
import { EndCard, Headlines, Montage } from "./Overlays";
import { Cursors, Desk, SpeedChip, TeamsPanel, Wire } from "./Stage";

type Cam = { fx: number; fy: number; s: number; tx: number; ty: number };

/** One camera: stage point (fx, fy) sits at screen (tx, ty) at scale s, eased between keyframes. */
function camera(t: number): Cam {
  const keys = T.camera as [number, Cam][];
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (t >= t0 && t <= t1) {
      const p = easeInOut((t - t0) / Math.max(1e-6, t1 - t0));
      return { fx: lerp(a.fx, b.fx, p), fy: lerp(a.fy, b.fy, p), s: lerp(a.s, b.s, p), tx: lerp(a.tx, b.tx, p), ty: lerp(a.ty, b.ty, p) };
    }
  }
  return keys[keys.length - 1][1];
}

export function Film() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cam = camera(t);
  return (
    <AbsoluteFill style={{ background: C.canvas }}>
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0",
          transform: `translate(${cam.tx - cam.fx * cam.s}px, ${cam.ty - cam.fy * cam.s}px) scale(${cam.s})`,
        }}
      >
        <Desk t={t} />
        <Wire t={t} />
        <TeamsPanel t={t} who="jonas" />
        <TeamsPanel t={t} who="amara" />
        <Cursors t={t} />
      </div>
      <Montage t={t} />
      <Headlines t={t} />
      <SpeedChip t={t} />
      <EndCard t={t} />
    </AbsoluteFill>
  );
}
