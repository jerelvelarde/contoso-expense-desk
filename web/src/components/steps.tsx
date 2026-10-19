import {
  ChevronDown12Regular,
  Chat12Regular,
  Checkmark12Filled,
  Dismiss12Filled,
  Edit12Filled,
  Sparkle12Filled,
  Warning12Filled,
} from "@fluentui/react-icons";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { ExpenseRequest, FieldEdit, LearnedRule, PersonRef, PolicyResult } from "../agent/contract";
import { totalOf } from "../agent/contract";
import { baseRuleFor } from "../agent/policy";
import { useDesk } from "../desk/DeskProvider";
import { dateRange, firstName, money, relativeTime, shortDate, useNow } from "../lib/format";
import { TeamsCardPreview } from "./TeamsCardPreview";
import { Avatar, cx } from "./ui";

/* ------------------------------------------------------------------ */
/* Step chrome: a dot on a rail, a sentence, and the tool behind it.   */
/* ------------------------------------------------------------------ */

export type DotTone = "done" | "live" | "wait" | "warn" | "ok" | "stop" | "learn" | "edit" | "quiet";

function Dot({ tone }: { tone: DotTone }) {
  const base = "relative z-10 grid size-6 place-items-center rounded-full";
  switch (tone) {
    case "done":
      return (
        <span className={cx(base, "bg-ink text-white")}>
          <Checkmark12Filled />
        </span>
      );
    case "ok":
      return (
        <span className={cx(base, "bg-ok text-white")}>
          <Checkmark12Filled />
        </span>
      );
    case "warn":
      return (
        <span className={cx(base, "bg-wait-wash text-wait ring-1 ring-wait/25")}>
          <Warning12Filled />
        </span>
      );
    case "stop":
      return (
        <span className={cx(base, "bg-stop text-white")}>
          <Dismiss12Filled />
        </span>
      );
    case "learn":
      return (
        <span className={cx(base, "bg-[linear-gradient(135deg,#0f6cbd,#0e8a8a)] text-white")}>
          <Sparkle12Filled />
        </span>
      );
    case "edit":
      return (
        <span className={cx(base, "bg-accent-wash text-accent-ink ring-1 ring-accent/25")}>
          <Edit12Filled />
        </span>
      );
    case "live":
      return (
        <span className={cx(base, "border border-accent bg-surface")}>
          <span className="size-2 animate-pulse-ring rounded-full bg-accent" />
        </span>
      );
    case "wait":
      return (
        <span className={cx(base, "border border-wait/50 bg-wait-wash")} style={{ ["--ring" as string]: "rgb(154 84 0 / 0.35)" }}>
          <span className="size-2 animate-pulse-ring rounded-full bg-wait" />
        </span>
      );
    case "quiet":
      return (
        <span className={cx(base, "border border-line-strong bg-surface text-ink-3")}>
          <Chat12Regular />
        </span>
      );
  }
}

export interface ToolInfo {
  name: string;
  args?: unknown;
  result?: unknown;
}

/** The tool name, inline, opening the raw call for anyone who wants proof. */
function ToolChip({ tool, open, onToggle }: { tool: ToolInfo; open: boolean; onToggle: () => void }) {
  const expandable = tool.args !== undefined;
  const chip = "inline-flex h-[22px] items-center gap-1 rounded-md bg-sunken px-1.5 font-mono text-xs text-ink-2";
  if (!expandable) return <code className={chip}>{tool.name}</code>;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={cx(chip, "transition-colors hover:bg-line hover:text-ink")}>
      {tool.name}
      <ChevronDown12Regular className={cx("transition-transform", open && "rotate-180")} />
    </button>
  );
}

export function Step({
  tone,
  title,
  detail,
  tool,
  superseded,
  meta,
  children,
}: {
  tone: DotTone;
  title: ReactNode;
  detail?: ReactNode;
  tool?: ToolInfo;
  /** A later call replaced this one: keep the sentence, drop the body. */
  superseded?: boolean;
  /** Extra items for the line under the title (after the tool chip). */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasMeta = Boolean(tool || meta || superseded);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
      className="group relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3.5 pb-6 last:pb-0"
    >
      <span aria-hidden className="absolute top-7 bottom-1 left-[11.5px] w-px bg-line group-last:hidden" />
      <span className={cx(superseded && "opacity-45 grayscale")}>
        <Dot tone={tone} />
      </span>
      <div className="min-w-0 pt-[2px]">
        <p className={cx("text-[14px] leading-6", superseded ? "text-ink-3" : "text-ink")}>
          <span className="font-medium">{title}</span>
          {detail ? <span className={superseded ? undefined : "text-ink-2"}> {detail}</span> : null}
        </p>
        {hasMeta ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
            {tool ? <ToolChip tool={tool} open={open} onToggle={() => setOpen((o) => !o)} /> : null}
            {superseded ? <span>Superseded by the re-check below</span> : null}
            {meta}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {open && tool?.args !== undefined ? (
            <motion.pre
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 max-h-56 w-full max-w-[560px] overflow-auto rounded-lg border border-line bg-sunken/70 px-3.5 py-3 font-mono text-xs leading-5 text-ink-2"
            >
              <span className="text-ink-3">args </span>
              {JSON.stringify(tool.args, null, 2)}
              {tool.result !== undefined ? (
                <>
                  {"\n"}
                  <span className="text-ink-3">result </span>
                  {JSON.stringify(tool.result, null, 2)}
                </>
              ) : null}
            </motion.pre>
          ) : null}
        </AnimatePresence>
        {children && !superseded ? <div className="mt-3 w-full max-w-[560px]">{children}</div> : null}
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

/** What the agent read out of the message, before any Finance edits. */
function originalOf(request: ExpenseRequest) {
  const firstEdit = (field: FieldEdit["field"]) => request.edits?.find((e) => e.field === field)?.from;
  const checkIn = (firstEdit("checkIn") as string | undefined) ?? request.checkIn;
  const checkOut = (firstEdit("checkOut") as string | undefined) ?? request.checkOut;
  const rate = (firstEdit("nightlyRate") as number | undefined) ?? request.nightlyRate;
  const city = (firstEdit("city") as string | undefined) ?? request.city;
  return { checkIn, checkOut, rate, city };
}

export function ReceivedStep({ request }: { request: ExpenseRequest }) {
  const now = useNow();
  const o = originalOf(request);
  const dates = dateRange(o.checkIn, o.checkOut);
  return (
    <Step
      tone="quiet"
      title={`${request.requester.name} messaged @Expenses`}
      detail={<span className="text-ink-3">in Teams · {relativeTime(request.createdAt, now)}</span>}
    >
      <blockquote className="rounded-lg bg-sunken/70 px-3.5 py-2.5 text-[14px] leading-6 text-ink-2">“{request.source.text}”</blockquote>
      <p className="mt-2 text-[13px] text-ink-2 tabular">
        <span className="text-ink-3">Read as </span>
        {["Hotel", o.city, dates, `${money(o.rate)} a night`].filter(Boolean).join(" · ")}
      </p>
    </Step>
  );
}

export function LookupStep({
  name,
  employee,
  manager,
  done,
  tool,
}: {
  name?: string;
  employee?: PersonRef;
  manager?: PersonRef;
  done: boolean;
  tool?: ToolInfo;
}) {
  const t = tool ?? { name: "lookup_employee" };
  if (!done || !employee || !manager) {
    return <Step tone="live" title="Looking up" detail={name ? `${name} in the directory…` : "the requester…"} tool={t} />;
  }
  return (
    <Step tone="done" title={`${employee.name} reports to ${manager.name}`} tool={t}>
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-[13px]">
        <Avatar name={manager.name} size={22} />
        <span className="text-ink-3">Manager</span>
        <span className="font-medium text-ink">{manager.name}</span>
        <span className="text-ink-3">{manager.title}</span>
      </span>
    </Step>
  );
}

export function PolicyStep({
  args,
  result,
  done,
  recheck = false,
  superseded = false,
  tool,
}: {
  args: { city?: string; nightlyRate?: number; nights?: number };
  result?: PolicyResult;
  done: boolean;
  /** A second check in the same request, triggered by Finance editing a field. */
  recheck?: boolean;
  /** A later check replaced this one. */
  superseded?: boolean;
  tool?: ToolInfo;
}) {
  const city = args.city ?? "";
  const base = city ? baseRuleFor(city) : undefined;
  const t = tool ?? { name: "check_policy" };

  if (!done || !result) {
    return (
      <Step
        tone="live"
        title={recheck ? "Re-checking policy" : "Checking hotel policy"}
        detail={recheck ? "with Finance's edit…" : city ? `for ${city}…` : "…"}
        tool={t}
      >
        {base && args.nightlyRate ? (
          <RuleRows>
            <RuleRow label={base.label} code={base.ruleId} value={`${money(base.capPerNight)}/night`} />
            <RuleRow label="This request" value={`${money(args.nightlyRate)}/night`} pending />
          </RuleRows>
        ) : null}
      </Step>
    );
  }

  const label = baseRuleFor(city).label;
  const place = label.replace(" hotel cap", "");
  if (result.outcome === "over") {
    return (
      <Step
        tone="warn"
        title={recheck ? `Re-checked: still over the ${place} cap` : `Over the ${place} hotel cap`}
        detail={`by ${money(result.overBy ?? 0)} a night`}
        tool={t}
        superseded={superseded}
      >
        <RuleRows>
          <RuleRow label={label} code={result.ruleId} value={`${money(result.capPerNight)}/night`} />
          <RuleRow label="This request" value={`${money(args.nightlyRate ?? 0)}/night`} tone="warn" note={`+${money(result.overBy ?? 0)}`} />
        </RuleRows>
      </Step>
    );
  }
  if (result.outcome === "within_learned" && result.learnedRule) {
    return (
      <Step
        tone="learn"
        title={recheck ? "Re-checked: within learned limit:" : "Within learned limit:"}
        detail={`${city} up to ${money(result.learnedRule.capPerNight)}/night`}
        tool={t}
        superseded={superseded}
      >
        <RuleRows>
          <RuleRow label={label} code={result.ruleId} value={`${money(result.capPerNight)}/night`} muted />
          <RuleRow label="Learned from manager approvals" code={result.learnedRule.id} value={`${money(result.learnedRule.capPerNight)}/night`} tone="learn" />
          <RuleRow label="This request" value={`${money(args.nightlyRate ?? 0)}/night`} tone="ok" note="within" />
        </RuleRows>
      </Step>
    );
  }
  return (
    <Step
      tone="done"
      title={recheck ? "Re-checked: now within policy" : "Within policy"}
      detail={`${label} is ${money(result.capPerNight)} a night`}
      tool={t}
      superseded={superseded}
    >
      <RuleRows>
        <RuleRow label={label} code={result.ruleId} value={`${money(result.capPerNight)}/night`} />
        <RuleRow label="This request" value={`${money(args.nightlyRate ?? 0)}/night`} tone="ok" note="within" />
      </RuleRows>
    </Step>
  );
}

function RuleRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{children}</div>;
}

function RuleRow({
  label,
  code,
  value,
  note,
  tone,
  muted,
  pending,
}: {
  label: string;
  code?: string;
  value: string;
  note?: string;
  tone?: "warn" | "ok" | "learn";
  muted?: boolean;
  pending?: boolean;
}) {
  const valueColor = tone === "warn" ? "text-wait" : tone === "ok" ? "text-ok" : tone === "learn" ? "text-learn" : "text-ink";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cx(
        "flex items-center justify-between gap-4 px-3.5 py-2.5 text-[13px]",
        tone === "warn" && "bg-wait-wash/50",
        tone === "learn" && "bg-learn-wash/60",
      )}
    >
      <span className={cx("flex min-w-0 items-center gap-2", muted ? "text-ink-3" : "text-ink-2")}>
        {tone === "learn" ? <Sparkle12Filled className="shrink-0 text-learn" /> : null}
        <span className="truncate">{label}</span>
        {code ? <code className="font-mono text-xs text-ink-3">{code}</code> : null}
      </span>
      <span
        className={cx(
          "flex shrink-0 items-baseline gap-2 font-medium tabular",
          muted ? "text-ink-3 line-through decoration-ink-3/40" : valueColor,
          pending && "text-ink-3",
        )}
      >
        {note ? <span className="text-xs font-medium">{note}</span> : null}
        {value}
      </span>
    </motion.div>
  );
}

export function ApprovalStep({ request, done, tool }: { request: ExpenseRequest; done: boolean; tool?: ToolInfo }) {
  const now = useNow();
  const manager = request.manager;
  const t = tool ?? { name: "submit_approval_request" };
  if (!done || !manager) {
    return <Step tone="live" title="Preparing the approval card" detail={manager ? `for ${manager.name}…` : "…"} tool={t} />;
  }
  const sentAt = request.approval?.sentAt;
  if (request.status === "awaiting_manager" && request.approval) {
    return (
      <Step
        tone="wait"
        title={`Waiting on ${manager.name}`}
        detail={<span className="text-ink-3">in Teams{sentAt ? ` · ${relativeTime(sentAt, now)}` : ""}</span>}
        tool={t}
      >
        <TeamsCardPreview request={request} />
      </Step>
    );
  }
  return (
    <Step
      tone="done"
      title={`Asked ${manager.name} to approve`}
      detail={<span className="text-ink-3">in Teams{sentAt ? ` · ${relativeTime(sentAt, now)}` : ""}</span>}
      tool={t}
    />
  );
}

export function DecisionStep({
  request,
  outcome,
  decidedBy,
  learnedRuleId,
  note,
  done,
  tool,
}: {
  request: ExpenseRequest;
  outcome?: "approved" | "rejected";
  decidedBy?: string;
  learnedRuleId?: string;
  note?: string;
  done: boolean;
  tool?: ToolInfo;
}) {
  const { desk } = useDesk();
  const t = tool ?? { name: "record_decision" };
  if (!done || !outcome) {
    return <Step tone="live" title="Recording the decision" detail="…" tool={t} />;
  }
  if (decidedBy === "agent") {
    const rule = learnedRuleId ? desk.learnedRules.find((r) => r.id === learnedRuleId) : undefined;
    if (learnedRuleId) {
      return (
        <Step tone="learn" title="Approved under learned rule" detail={<code className="font-mono text-[13px]">{learnedRuleId}</code>} tool={t}>
          {rule ? <LearnedRuleCard rule={rule} /> : null}
        </Step>
      );
    }
    return <Step tone="ok" title="Approved by the agent" detail="within policy" tool={t} />;
  }
  const who = request.manager?.name ?? "Manager";
  if (outcome === "rejected") {
    return (
      <Step tone="stop" title={`Rejected by ${who}`} detail="in Teams" tool={t}>
        {note ? <blockquote className="border-l-2 border-stop/40 pl-3 text-[13px] text-ink-2">“{note}”</blockquote> : null}
      </Step>
    );
  }
  return <Step tone="ok" title={`Approved by ${who}`} detail={<span className="tabular">in Teams · {money(totalOf(request))}</span>} tool={t} />;
}

export function LearnedRuleCard({ rule }: { rule: LearnedRule }) {
  return (
    <div className="learned-border rounded-lg px-3.5 py-3">
      <p className="font-serif text-[20px] leading-6 text-ink">{rule.title}.</p>
      <p className="mt-1.5 text-xs leading-5 text-ink-2">
        Learned from {rule.evidence.approvals} manager approvals at{" "}
        <span className="tabular">{rule.evidence.rates.map((r) => money(r)).join(" · ")}</span>. No manager needed; the agent cites the rule each
        time it applies it.
      </p>
    </div>
  );
}

const FIELD_LABEL: Record<FieldEdit["field"], string> = {
  city: "city",
  purpose: "purpose",
  nightlyRate: "nightly rate",
  checkIn: "check-in date",
  checkOut: "check-out date",
  costCenter: "cost centre",
};

export function editValue(field: FieldEdit["field"], v: string | number) {
  if (field === "nightlyRate") return money(Number(v));
  if (field === "checkIn" || field === "checkOut") return shortDate(String(v));
  return String(v);
}

export function EditStep({ edit, synced }: { edit: FieldEdit; synced: boolean }) {
  const { desk } = useDesk();
  const who = desk.people[edit.by]?.name ?? "Priya Raman";
  return (
    <Step
      tone="edit"
      title={`${firstName(who)} in Finance changed the ${FIELD_LABEL[edit.field]}`}
      detail={
        <span className="tabular">
          <span className="text-ink-3 line-through">{editValue(edit.field, edit.from)}</span> → {editValue(edit.field, edit.to)}
        </span>
      }
      meta={
        synced ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <Checkmark12Filled /> Synced to the agent
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-accent-ink">
            <span className="size-1.5 animate-pulse-ring rounded-full bg-accent" /> Syncing to the agent
          </span>
        )
      }
    />
  );
}

/** Whole sentences, enough to say something (so never just "Thanks Amara."). */
function summarise(text: string, min = 48) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    out += s;
    if (out.trim().length >= min) break;
  }
  return out.trim();
}

export function ReplyStep({ request, content, collapsed }: { request: ExpenseRequest; content: string; collapsed?: boolean }) {
  return (
    <Step tone="quiet" title={`Replied to ${firstName(request.requester.name)}`} detail={<span className="text-ink-3">in Teams</span>}>
      {collapsed ? (
        <p className="truncate text-[13px] text-ink-3" title={content}>
          {summarise(content)}
        </p>
      ) : (
        <p className="text-[13px] leading-6 text-ink-2">{content}</p>
      )}
    </Step>
  );
}
