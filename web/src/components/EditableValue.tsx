import { Edit12Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

type Kind = "text" | "money" | "date" | "select";

/**
 * Reads as plain text until clicked, then becomes an input in place. Commits on
 * Enter or blur, cancels on Escape.
 */
export function EditableValue({
  label,
  value,
  display,
  kind,
  options,
  editable,
  showPencil = true,
  onCommit,
}: {
  label: string;
  value: string | number;
  display: ReactNode;
  kind: Kind;
  options?: string[];
  editable: boolean;
  /** Off when an original value sits beside this one, so the pencil has nowhere to crowd. */
  showPencil?: boolean;
  onCommit: (value: string | number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement && kind !== "date") ref.current.select();
  }, [editing, kind]);

  if (!editable) return <span className="text-ink">{display}</span>;

  const commit = (raw = draft) => {
    setEditing(false);
    const trimmed = raw.trim();
    if (!trimmed) return;
    const next = kind === "money" ? Math.round(Number(trimmed.replace(/[£,\s]/g, ""))) : trimmed;
    if (kind === "money" && (!Number.isFinite(next) || (next as number) < 1 || (next as number) > 5000)) return;
    if (String(next) !== String(value)) onCommit(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className="group relative -mx-1.5 inline-flex min-w-0 items-center rounded-md px-1.5 py-0.5 text-ink transition-colors hover:bg-sunken"
      >
        {display}
        {showPencil ? <Edit12Regular className="pointer-events-none absolute top-1/2 -left-3.5 -translate-y-1/2 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /> : null}
      </button>
    );
  }

  const inputClass =
    "h-7 rounded-md border border-accent bg-surface px-2 text-[13px] text-ink tabular shadow-[0_0_0_3px_var(--color-accent-wash)] outline-none";
  const width = { money: "w-24 pl-5 text-left", date: "w-[136px] text-right", text: "w-[150px] text-right", select: "w-[200px]" }[kind];

  if (kind === "select") {
    return (
      <select
        ref={ref}
        aria-label={label}
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className={cx(inputClass, width)}
      >
        {options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span className="relative inline-flex items-center">
      {kind === "money" ? <span className="pointer-events-none absolute left-2 text-[13px] text-ink-3">£</span> : null}
      <input
        ref={ref}
        aria-label={label}
        type={kind === "date" ? "date" : "text"}
        inputMode={kind === "money" ? "numeric" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className={cx(inputClass, width)}
      />
    </span>
  );
}
