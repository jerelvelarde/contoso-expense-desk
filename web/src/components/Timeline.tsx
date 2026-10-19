import { useRenderToolCall } from "@copilotkit/react-core/v2";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { isOpen, type ExpenseRequest } from "../agent/contract";
import { useDesk } from "../desk/DeskProvider";
import { CallPositionContext } from "../desk/repeat";
import { buildTimeline } from "../desk/timeline";
import { ApprovalStep, DecisionStep, EditStep, LookupStep, PolicyStep, ReceivedStep, ReplyStep, Step } from "./steps";

export function Timeline({ request }: { request: ExpenseRequest }) {
  const { messages, isRunning, syncing } = useDesk();
  const renderToolCall = useRenderToolCall();
  const entries = buildTimeline(messages, request.id, request.edits);

  const last = entries.at(-1);
  const lastDone = !last || last.kind !== "tool" || Boolean(last.toolMessage);
  const thinking = isOpen(request) && request.status !== "awaiting_manager" && isRunning && lastDone;
  const lastEditIndex = entries.map((e) => e.kind).lastIndexOf("edit");
  const lastReplyIndex = entries.map((e) => e.kind).lastIndexOf("reply");

  // Count calls per tool name so a renderer can tell a repeat from a superseded call.
  const totals = new Map<string, number>();
  for (const e of entries) if (e.kind === "tool") totals.set(e.toolCall.function.name, (totals.get(e.toolCall.function.name) ?? 0) + 1);
  const seen = new Map<string, number>();

  // While the agent works, keep its newest step in view.
  const list = useRef<HTMLOListElement>(null);
  const signature = `${entries.length}:${last?.kind === "tool" ? Boolean(last.toolMessage) : last?.kind}:${thinking}`;
  useEffect(() => {
    if (!isRunning) return;
    const t = setTimeout(() => {
      list.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
    return () => clearTimeout(t);
  }, [signature, isRunning]);

  return (
    <ol ref={list} className="relative scroll-mb-8">
      <ReceivedStep request={request} />
      {entries.length > 0 ? (
        <AnimatePresence initial={false}>
          {entries.map((e, i) => {
            if (e.kind === "reply") return <ReplyStep key={e.key} request={request} content={e.content} collapsed={i < lastReplyIndex} />;
            if (e.kind === "edit") return <EditStep key={e.key} edit={e.edit} synced={!(syncing && i === lastEditIndex)} />;
            const name = e.toolCall.function.name;
            const index = seen.get(name) ?? 0;
            seen.set(name, index + 1);
            const position = { repeat: index > 0, superseded: index < (totals.get(name) ?? 1) - 1 };
            return (
              <CallPositionContext.Provider key={e.key} value={position}>
                {renderToolCall({ toolCall: e.toolCall, toolMessage: e.toolMessage })}
              </CallPositionContext.Provider>
            );
          })}
        </AnimatePresence>
      ) : (
        <HistorySteps request={request} />
      )}
      {thinking ? <Step tone="live" title={entries.length ? "Working…" : "Reading the request…"} /> : null}
    </ol>
  );
}

/** Requests decided before this session have no live tool calls; rebuild their trail from state. */
function HistorySteps({ request }: { request: ExpenseRequest }) {
  const d = request.decision;
  return (
    <>
      {request.employee && request.manager ? <LookupStep employee={request.employee} manager={request.manager} done /> : null}
      {request.policy ? (
        <PolicyStep args={{ city: request.city, nightlyRate: request.nightlyRate, nights: request.nights }} result={request.policy} done />
      ) : null}
      {request.policy?.outcome === "over" && request.manager ? <ApprovalStep request={request} done /> : null}
      {d ? (
        <DecisionStep
          request={request}
          outcome={d.outcome}
          decidedBy={d.by === "agent" ? "agent" : d.by}
          learnedRuleId={d.learnedRuleId}
          note={d.note}
          done
        />
      ) : null}
    </>
  );
}
