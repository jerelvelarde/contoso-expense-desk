import { Dismiss16Regular, Keyboard16Regular } from "@fluentui/react-icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { seedDeskState } from "../agent/seed";
import { useDesk } from "../desk/DeskProvider";
import { cx } from "./ui";

/**
 * Presenter controls for the scripted agent. They stand in for Teams: the
 * employee's message, the manager's button press, and Automatic Learning.
 * Always on the "D" key; the on-screen hint only shows with `?presenter`, so a
 * recording never catches it by accident. Hosted builds for testers set
 * `VITE_SHOW_DEMO_CONTROLS=true` to show the hint and open the panel on load.
 */
const SHOW_BY_DEFAULT = import.meta.env.VITE_SHOW_DEMO_CONTROLS === "true";

export function DemoControls() {
  const { desk, run, isRunning, reset } = useDesk();
  const showHint = SHOW_BY_DEFAULT || new URLSearchParams(window.location.search).has("presenter");
  const [open, setOpen] = useState(SHOW_BY_DEFAULT);

  const awaiting = desk.requests.find((r) => r.status === "awaiting_manager");
  const hasLearned = desk.learnedRules.length > 0;
  const londonApprovals = desk.requests.filter(
    (r) => r.city === "London" && r.status === "approved" && r.policy?.outcome === "over",
  ).length;
  const usedLearned = desk.requests.some((r) => r.decision?.learnedRuleId);

  const steps = [
    {
      key: "1",
      label: "Amara asks for a London hotel",
      hint: "£320 a night, over the £250 cap",
      enabled: !isRunning,
      action: () => run({ scene: "request", variant: "over_cap" }),
    },
    {
      key: "2",
      label: "Jonas approves in Teams",
      hint: awaiting ? `${awaiting.id} is waiting` : "Needs a request waiting on Jonas",
      enabled: Boolean(awaiting) && !isRunning,
      action: () => awaiting && run({ scene: "decision", requestId: awaiting.id, outcome: "approved" }),
      alt: {
        label: "Reject",
        action: () =>
          awaiting && run({ scene: "decision", requestId: awaiting.id, outcome: "rejected", note: "Please use the partner rate at the ExCeL hotel." }),
      },
    },
    {
      key: "3",
      label: "Automatic Learning runs",
      hint: hasLearned ? "Rule already learned" : `${londonApprovals} London approvals so far`,
      enabled: !hasLearned && londonApprovals >= 3 && !isRunning,
      action: () => run({ scene: "learn" }),
    },
    {
      key: "4",
      label: "Amara asks again",
      hint: "£335 a night, inside the learned limit",
      enabled: !isRunning,
      action: () => run({ scene: "request", variant: "learned" }),
    },
  ];

  const nextKey = awaiting ? "2" : !hasLearned && londonApprovals >= 4 ? "3" : hasLearned && !usedLearned ? "4" : "1";

  const doReset = useCallback(() => reset(seedDeskState()), [reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!["d", "r", "1", "2", "3", "4"].includes(k)) return;
      // Don't leave a focus ring on whatever was clicked last.
      (document.activeElement as HTMLElement | null)?.blur();
      if (k === "d") setOpen((o) => !o);
      else if (k === "r" && !isRunning) doReset();
      else {
        const step = steps.find((s) => s.key === k);
        if (step?.enabled) step.action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!showHint && !open) return null;

  return (
    <div className="fixed bottom-5 left-5 z-40">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            className="w-[316px] rounded-xl bg-ink p-2 text-white shadow-float"
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <span className="font-mono text-[11px] tracking-[0.08em] text-white/60 uppercase">Demo · stands in for Teams</span>
              <button type="button" aria-label="Close demo controls" onClick={() => setOpen(false)} className="rounded p-1 text-white/60 hover:text-white">
                <Dismiss16Regular />
              </button>
            </div>
            <ol className="space-y-0.5">
              {steps.map((s) => (
                <li key={s.key} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    disabled={!s.enabled}
                    onClick={s.action}
                    className={cx(
                      "grid flex-1 grid-cols-[22px_1fr] gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      s.key === nextKey && s.enabled ? "bg-white/12" : "hover:bg-white/8",
                    )}
                  >
                    <kbd className="mt-px grid size-5 place-items-center rounded border border-white/20 font-mono text-[11px] text-white/80">{s.key}</kbd>
                    <span>
                      <span className="block text-[13px] font-medium">{s.label}</span>
                      <span className="block text-xs text-white/55">{s.hint}</span>
                    </span>
                  </button>
                  {s.alt ? (
                    <button
                      type="button"
                      disabled={!s.enabled}
                      onClick={s.alt.action}
                      className="rounded-lg px-2.5 text-xs text-white/70 hover:bg-white/8 disabled:opacity-50"
                    >
                      {s.alt.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={doReset}
              disabled={isRunning}
              className="mt-1 w-full rounded-lg px-2 py-2 text-left text-xs text-white/60 hover:bg-white/8 disabled:opacity-50"
            >
              <kbd className="mr-2 font-mono">R</kbd> Reset to seed data
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface/80 px-3 text-xs text-ink-3 backdrop-blur hover:text-ink-2"
          >
            <Keyboard16Regular /> Demo controls <kbd className="font-mono text-[11px]">D</kbd>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
