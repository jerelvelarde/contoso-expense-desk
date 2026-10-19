import { ArrowSync12Regular, Receipt16Filled } from "@fluentui/react-icons";
import { motion } from "motion/react";
import type { ExpenseRequest } from "../agent/contract";
import { dateRange, firstName, money, relativeTime, useNow } from "../lib/format";
import { cx } from "./ui";

/**
 * A preview of the manager's Adaptive Card (cards/approval-request.json). It
 * renders only the facts the agent put on the card, so it changes when the
 * agent refreshes the card after a Finance edit, never before.
 */
export function TeamsCardPreview({ request }: { request: ExpenseRequest }) {
  const now = useNow();
  const approval = request.approval;
  if (!approval) return null;
  const card = approval.card;
  const manager = firstName(request.manager?.name);

  const changed = new Set(approval.updatedAt ? (approval.changed ?? []) : []);
  const facts: { label: string; value: string; keys: (keyof typeof card)[] }[] = [
    {
      label: "Dates",
      value: `${dateRange(card.checkIn, card.checkOut) ?? "—"} · ${card.nights} night${card.nights === 1 ? "" : "s"}`,
      keys: ["checkIn", "checkOut", "nights"],
    },
    { label: "Rate", value: `${money(card.nightlyRate)} a night`, keys: ["nightlyRate"] },
    { label: "Total", value: money(card.total), keys: ["total"] },
    ...(card.costCenter ? [{ label: "Cost centre", value: card.costCenter, keys: ["costCenter" as const] }] : []),
    {
      label: "Policy",
      value: card.overBy > 0 ? `${money(card.overBy)}/night over the ${card.city} cap (${money(card.capPerNight)})` : `Within the ${card.city} cap`,
      keys: ["overBy", "capPerNight"],
    },
  ];

  return (
    <div>
      <motion.div
        key={approval.updatedAt ?? "sent"}
        initial={approval.updatedAt ? { boxShadow: "0 0 0 3px rgb(15 108 189 / 0.35)" } : false}
        animate={{ boxShadow: "0 1px 3px rgb(0 0 0 / 0.08)" }}
        transition={{ duration: 1.6 }}
        className="overflow-hidden rounded-lg border border-[#e1dfdd] bg-white"
        style={{ fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' }}
      >
        <div className="flex items-center gap-2.5 border-b border-[#edebe9] px-4 py-2.5">
          <span className="grid size-6 place-items-center rounded-md bg-teams text-white">
            <Receipt16Filled />
          </span>
          <span className="text-[13px] font-semibold text-[#242424]">Expenses</span>
          <span className="text-[12px] text-[#616161]">Approval needed</span>
        </div>
        <div className="space-y-3 px-4 pt-3 pb-4">
          <div>
            <p className="text-[15px] font-semibold text-[#242424]">
              Hotel in {card.city} · {card.purpose}
            </p>
            <p className="mt-0.5 text-[13px] text-[#424242]">
              {card.requesterName} needs your approval
              {card.overBy > 0 ? `. It's ${money(card.overBy)} a night over the ${card.city} cap.` : "."}
            </p>
          </div>
          <dl className="-mx-1.5 text-[13px]">
            {facts.map((f) => (
              <div
                key={`${f.label}-${approval.updatedAt ?? ""}`}
                className={cx("grid grid-cols-[96px_1fr] gap-x-3 rounded px-1.5 py-px", f.keys.some((k) => changed.has(k)) && "animate-fade-wash-long")}
              >
                <dt className="font-semibold text-[#424242]">{f.label}</dt>
                <dd className="tabular text-[#242424]">{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2 pt-1" aria-hidden>
            <span className="inline-flex h-8 items-center rounded-[4px] bg-teams px-4 text-[13px] font-semibold text-white">Approve</span>
            <span className="inline-flex h-8 items-center rounded-[4px] border border-[#d1d1d1] bg-white px-4 text-[13px] font-semibold text-[#242424]">
              Reject
            </span>
          </div>
        </div>
      </motion.div>
      <p className="mt-2 text-xs leading-5 text-ink-3">What {manager || "the manager"} sees in Teams</p>
      {approval.updatedAt ? (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 text-xs leading-5 text-accent-ink">
          <ArrowSync12Regular className="shrink-0" /> The agent updated the card with Finance's edit {relativeTime(approval.updatedAt, now)}
        </motion.p>
      ) : null}
    </div>
  );
}
