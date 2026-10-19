import { financeUser } from "../agent/seed";
import { useDesk } from "../desk/DeskProvider";
import { firstName } from "../lib/format";
import { LearnedRulesButton } from "./Learned";
import { Avatar, cx } from "./ui";

export function TopBar({ mode }: { mode: "runtime" | "demo" }) {
  const { isRunning, desk } = useDesk();
  const waiting = desk.requests.find((r) => r.status === "awaiting_manager");

  // Say what the agent is doing, never how it is hosted.
  const state = isRunning
    ? { dot: "animate-pulse-ring bg-accent", label: "Working" }
    : waiting
      ? { dot: "bg-wait", label: `Paused · waiting on ${firstName(waiting.manager?.name) || "manager"}` }
      : { dot: "bg-ok", label: "Online" };

  return (
    <header className="flex h-14 items-center justify-between px-5">
      <div className="flex items-center gap-2.5 text-[14px]">
        <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-ink text-[15px] font-bold text-white">
          C
        </span>
        <span className="font-semibold text-ink">Contoso</span>
        <span className="text-line-strong">/</span>
        <span className="text-ink-2">Expense Desk</span>
      </div>
      <div className="flex items-center gap-3">
        <LearnedRulesButton />
        <div
          className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-2"
          title={mode === "runtime" ? "Microsoft Agent Framework via the CopilotKit .NET runtime" : undefined}
        >
          <span className={cx("size-1.5 rounded-full", state.dot)} />
          <span className="font-medium text-ink">Expense agent</span>
          <span>{state.label}</span>
        </div>
        <span title={`${financeUser.name} · ${financeUser.title}`}>
          <Avatar name={financeUser.name} size={30} />
        </span>
      </div>
    </header>
  );
}
