import { Sparkle12Filled } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import type { ExpenseRequest, RequestStatus } from "../agent/contract";
import { firstName, hueFor, initials } from "../lib/format";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-xs font-medium text-ink-3", className)}>{children}</div>;
}

/** Colour is keyed on the name so a person looks the same before and after the directory lookup. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const h = hueFor(name);
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.38),
        background: `oklch(0.93 0.03 ${h})`,
        color: `oklch(0.38 0.06 ${h})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

type Tone = "wait" | "ok" | "stop" | "learn" | "live";

/** One vocabulary for status, used by the queue, the header and the top bar. */
export function statusMeta(r: ExpenseRequest): { tone: Tone; label: string; short: string } {
  const manager = firstName(r.manager?.name) || "manager";
  const map: Record<RequestStatus, { tone: Tone; label: string; short: string }> = {
    received: { tone: "live", label: "Agent working", short: "Agent working" },
    checking: { tone: "live", label: "Agent working", short: "Agent working" },
    awaiting_manager: { tone: "wait", label: `Waiting on ${manager}`, short: "Waiting" },
    approved: { tone: "ok", label: `Approved by ${manager}`, short: "Approved" },
    rejected: { tone: "stop", label: `Rejected by ${manager}`, short: "Rejected" },
    auto_approved: r.decision?.learnedRuleId
      ? { tone: "learn", label: "Approved · learned rule", short: "Learned rule" }
      : { tone: "ok", label: "Approved · within policy", short: "Within policy" },
  };
  return map[r.status];
}

const toneClass: Record<Tone, string> = {
  live: "text-accent-ink bg-accent-wash",
  wait: "text-wait bg-wait-wash",
  ok: "text-ok bg-ok-wash",
  stop: "text-stop bg-stop-wash",
  learn: "text-learn bg-learn-wash",
};

const textClass: Record<Tone, string> = {
  live: "text-accent-ink",
  wait: "text-wait",
  ok: "text-ok",
  stop: "text-stop",
  learn: "text-learn",
};

const dotClass: Record<Tone, string> = {
  live: "bg-accent",
  wait: "bg-wait",
  ok: "bg-ok",
  stop: "bg-stop",
  learn: "bg-learn",
};

function Marker({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  if (tone === "learn") return <Sparkle12Filled className="shrink-0" />;
  return <span className={cx("size-1.5 shrink-0 rounded-full", dotClass[tone], pulse && "animate-pulse")} />;
}

export function StatusPill({ request }: { request: ExpenseRequest }) {
  const { tone, label } = statusMeta(request);
  return (
    <span className={cx("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap", toneClass[tone])}>
      <Marker tone={tone} pulse={tone === "live" || tone === "wait"} />
      {label}
    </span>
  );
}

export function StatusText({ request }: { request: ExpenseRequest }) {
  const { tone, short } = statusMeta(request);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", textClass[tone])}>
      <Marker tone={tone} />
      {short}
    </span>
  );
}
