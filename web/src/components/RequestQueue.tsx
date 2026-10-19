import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { isOpen, totalOf, type ExpenseRequest } from "../agent/contract";
import { useDesk } from "../desk/DeskProvider";
import { relativeTime, useNow } from "../lib/format";
import { Avatar, StatusText, cx } from "./ui";

export function RequestQueue() {
  const { desk, selectedId, select } = useDesk();
  const now = useNow();
  const sorted = [...desk.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = sorted.filter(isOpen);
  const done = sorted.filter((r) => !isOpen(r));

  // Rows that appeared after first paint get a brief highlight.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = desk.requests.map((r) => r.id);
    if (known.current === null) {
      known.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !known.current!.has(id));
    if (added.length) {
      added.forEach((id) => known.current!.add(id));
      setFresh((s) => new Set([...s, ...added]));
    }
  }, [desk.requests]);

  return (
    <nav aria-label="Requests" className="flex min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-5 pt-6 pb-2">
        <h2 className="text-[13px] font-semibold text-ink">Requests</h2>
        {open.length ? <span className="text-xs text-ink-2 tabular">{open.length} open</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6">
        {open.length > 0 ? <GroupLabel>In progress</GroupLabel> : null}
        <ul className="space-y-0.5">
          <AnimatePresence initial={false} mode="popLayout">
            {open.map((r) => (
              <Row key={r.id} request={r} now={now} selected={r.id === selectedId} fresh={fresh.has(r.id)} onSelect={select} />
            ))}
          </AnimatePresence>
        </ul>
        {done.length > 0 ? <GroupLabel>Recent</GroupLabel> : null}
        <ul className="space-y-0.5">
          <AnimatePresence initial={false} mode="popLayout">
            {done.map((r) => (
              <Row key={r.id} request={r} now={now} selected={r.id === selectedId} fresh={false} onSelect={select} />
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </nav>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <div className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-ink-3">{children}</div>;
}

function Row({
  request: r,
  now,
  selected,
  fresh,
  onSelect,
}: {
  request: ExpenseRequest;
  now: number;
  selected: boolean;
  fresh: boolean;
  onSelect: (id: string) => void;
}) {
  const name = r.employee?.name ?? r.requester.name;
  return (
    <motion.li
      layout
      layoutId={`row-${r.id}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
    >
      <button
        type="button"
        onClick={() => onSelect(r.id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "grid w-full grid-cols-[30px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
          selected ? "bg-surface shadow-sheet" : "hover:bg-sunken/70",
          fresh && !selected && "animate-fade-wash",
        )}
      >
        <Avatar name={name} size={30} />
        <span className="min-w-0 space-y-0.5">
          {/* Each line pairs a label with its own value so neither starves the other. */}
          <span className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] font-medium text-ink">{name}</span>
              <span className="shrink-0 text-xs text-ink-3">{relativeTime(r.createdAt, now)}</span>
            </span>
            <span className="shrink-0 text-[13px] font-medium text-ink tabular">£{totalOf(r).toLocaleString("en-GB")}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] text-ink-2">
              <span className="max-[1360px]:hidden">{r.city} · </span>
              {r.purpose}
            </span>
            <span className="shrink-0">
              <StatusText request={r} />
            </span>
          </span>
        </span>
      </button>
    </motion.li>
  );
}
