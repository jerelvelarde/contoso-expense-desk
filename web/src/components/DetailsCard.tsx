import { Checkmark12Filled, Edit12Regular, LockClosed12Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import peopleJson from "../../../seed/people.json";
import { isOpen, totalOf, type EditableField, type ExpenseRequest } from "../agent/contract";
import { useDesk } from "../desk/DeskProvider";
import { money, shortDate } from "../lib/format";
import { EditableValue } from "./EditableValue";
import { editValue } from "./steps";
import { cx } from "./ui";

const COST_CENTRES = [...new Set(peopleJson.employees.map((e) => e.costCenter))].sort();

interface Row {
  field: EditableField;
  label: string;
  kind: "text" | "money" | "date" | "select";
  value: string | number;
  display: ReactNode;
}

/**
 * The request fields Finance may correct. They live in AG-UI shared state:
 * an edit triggers an agent run that re-checks policy and refreshes the
 * manager's card. City and purpose are in the header, so they aren't repeated.
 */
export function DetailsCard({ request }: { request: ExpenseRequest }) {
  const { editRequest, syncing, justSynced } = useDesk();
  const editable = isOpen(request);
  const originalOf = (field: EditableField) => request.edits?.find((e) => e.field === field)?.from;

  const rows: Row[] = [
    ...(request.checkIn
      ? [{ field: "checkIn" as const, label: "Check-in", kind: "date" as const, value: request.checkIn, display: shortDate(request.checkIn) }]
      : []),
    ...(request.checkOut
      ? [{ field: "checkOut" as const, label: "Check-out", kind: "date" as const, value: request.checkOut, display: shortDate(request.checkOut) }]
      : []),
    { field: "nightlyRate", label: "Nightly rate", kind: "money", value: request.nightlyRate, display: money(request.nightlyRate) },
    ...(request.costCenter
      ? [{ field: "costCenter" as const, label: "Cost centre", kind: "select" as const, value: request.costCenter, display: request.costCenter }]
      : []),
  ];

  return (
    <section aria-label="Request details" className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink">Details</h3>
        <SyncBadge editable={editable} syncing={syncing} justSynced={justSynced} />
      </header>
      <dl className="px-4 py-1">
        {rows.map((row) => {
          const original = originalOf(row.field);
          const changed = original !== undefined && String(original) !== String(row.value);
          return (
            <div key={row.label} className="flex min-h-10 items-center justify-between gap-3 border-b border-line/70 text-[13px] last:border-0">
              <dt className="shrink-0 text-ink-2">{row.label}</dt>
              <dd className="flex min-w-0 items-center justify-end gap-2 tabular">
                {changed ? (
                  <span className="text-ink-3 line-through" title="Original value from the request">
                    {editValue(row.field, original!)}
                  </span>
                ) : null}
                <EditableValue
                  label={row.label}
                  value={row.value}
                  display={<span className={cx("truncate", changed && "font-medium text-accent-ink")}>{row.display}</span>}
                  kind={row.kind}
                  options={COST_CENTRES}
                  editable={editable}
                  showPencil={!changed}
                  onCommit={(v) => editRequest(request.id, row.field, v)}
                />
              </dd>
            </div>
          );
        })}
      </dl>
      <footer className="flex items-baseline justify-between border-t border-line px-4 py-3">
        <span className="text-[13px] text-ink-2">
          <span className="font-medium text-ink">Total</span> · {request.nights} night{request.nights === 1 ? "" : "s"}
        </span>
        <span className="text-[15px] font-semibold text-ink tabular">{money(totalOf(request))}</span>
      </footer>
    </section>
  );
}

function SyncBadge({ editable, syncing, justSynced }: { editable: boolean; syncing: boolean; justSynced: boolean }) {
  const base = "inline-flex items-center gap-1.5 text-xs";
  if (!editable) {
    return (
      <span className={cx(base, "text-ink-3")}>
        <LockClosed12Regular /> Locked after decision
      </span>
    );
  }
  if (syncing) {
    return (
      <span className={cx(base, "text-accent-ink")}>
        <span className="size-1.5 animate-pulse-ring rounded-full bg-accent" /> Agent re-checking
      </span>
    );
  }
  if (justSynced) {
    return (
      <span className={cx(base, "text-ok")}>
        <Checkmark12Filled /> Synced with agent
      </span>
    );
  }
  return (
    <span className={cx(base, "text-ink-3")} title="Edits sync to the agent through AG-UI shared state">
      <Edit12Regular /> Click a value to edit
    </span>
  );
}
