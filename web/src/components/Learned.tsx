import { Dismiss16Regular, Open12Regular, Sparkle12Filled } from "@fluentui/react-icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LearnedRule } from "../agent/contract";
import { useDesk } from "../desk/DeskProvider";
import { money, relativeTime, useNow } from "../lib/format";
import { cx, Eyebrow } from "./ui";

const INTELLIGENCE_URL = import.meta.env.VITE_INTELLIGENCE_DASHBOARD_URL as string | undefined;

function Evidence({ rule }: { rule: LearnedRule }) {
  const { desk } = useDesk();
  const approvers = rule.evidence.approverIds.map((id) => desk.people[id]?.name ?? id).join(", ");
  return (
    <div className="space-y-1 text-xs leading-5 text-ink-2">
      <p>
        From {rule.evidence.approvals} approvals by {approvers} at{" "}
        <span className="font-medium text-ink tabular">{rule.evidence.rates.map((r) => money(r)).join(" · ")}</span>
      </p>
      <p className="flex flex-wrap gap-x-2 font-mono text-ink-3">
        {rule.evidence.requestIds.map((id) => (
          <span key={id} className="whitespace-nowrap">
            {id}
          </span>
        ))}
      </p>
    </div>
  );
}

function RuleMeta({ rule }: { rule: LearnedRule }) {
  const now = useNow();
  return (
    <p className="text-xs text-ink-3">
      <span className="font-mono">{rule.id}</span> · CopilotKit Intelligence · {relativeTime(rule.learnedAt, now)}
    </p>
  );
}

function IntelligenceLink() {
  if (!INTELLIGENCE_URL) return null;
  return (
    <a href={INTELLIGENCE_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
      Open in CopilotKit Intelligence <Open12Regular />
    </a>
  );
}

/**
 * Shown once in the request's side column when Automatic Learning produces a
 * rule, in place of the (by then locked) Details card. It inherits the
 * column's position and width, and leaves when the agent starts the next request.
 */
export function LearnedAnnouncement({ rule }: { rule: LearnedRule }) {
  const { dismissAnnouncement } = useDesk();
  return (
    <section aria-label="New learned rule" className="learned-border rounded-xl p-4 shadow-sheet">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-learn-wash px-2 py-0.5 text-xs font-medium text-learn">
          <Sparkle12Filled /> New from Automatic Learning
        </span>
        <button type="button" aria-label="Dismiss" onClick={dismissAnnouncement} className="-m-1 rounded-md p-1 text-ink-3 hover:bg-sunken">
          <Dismiss16Regular />
        </button>
      </div>
      <p className="mt-3 font-serif text-[22px] leading-[1.15] text-ink">{rule.title}.</p>
      <div className="mt-2.5 space-y-2">
        <Evidence rule={rule} />
        <RuleMeta rule={rule} />
      </div>
      <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">The agent will apply it to the next London hotel request and cite it.</p>
      <IntelligenceLink />
    </section>
  );
}

/** Top-bar entry point. Exists once the agent has learned something; glows while a rule is being announced. */
export function LearnedRulesButton() {
  const { desk, announcedRuleId, dismissAnnouncement } = useDesk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rules = desk.learnedRules;
  if (!rules.length) return null;

  return (
    <div ref={ref} className="relative">
      <motion.button
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        type="button"
        onClick={() => {
          dismissAnnouncement();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className={cx(
          "learned-border inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-learn transition-shadow",
          announcedRuleId && "shadow-[0_0_0_4px_var(--color-learn-wash)]",
        )}
      >
        <Sparkle12Filled />
        {rules.length} learned rule{rules.length === 1 ? "" : "s"}
      </motion.button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label="Learned rules"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="absolute top-11 right-0 z-30 w-[380px] origin-top-right rounded-xl bg-surface p-4 shadow-float"
          >
            <Eyebrow>Learned by the agent</Eyebrow>
            <ul className="mt-3 space-y-4">
              {rules.map((r) => (
                <li key={r.id}>
                  <p className="font-serif text-[22px] leading-[1.15] text-ink">{r.title}.</p>
                  <div className="mt-2 space-y-2">
                    <Evidence rule={r} />
                    <RuleMeta rule={r} />
                  </div>
                </li>
              ))}
            </ul>
            <IntelligenceLink />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
