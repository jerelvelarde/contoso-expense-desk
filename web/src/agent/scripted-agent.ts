import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@copilotkit/react-core/v2";
import { Observable } from "rxjs";
import {
  TOOL,
  emptyDeskState,
  isOpen,
  totalOf,
  type ApprovalCardFacts,
  type CheckPolicyArgs,
  type EditableField,
  type ExpenseDeskState,
  type ExpenseRequest,
  type LookupEmployeeArgs,
  type LookupEmployeeResult,
  type RecordDecisionArgs,
  type SubmitApprovalArgs,
} from "./contract";
import { baseRuleFor, evaluatePolicy } from "./policy";
import { directory, findEmployeeByName, personRef } from "./seed";

/**
 * A stand-in for the .NET Microsoft Agent Framework agent. It emits the same
 * AG-UI events (state snapshots, streamed tool calls, text replies) so the
 * dashboard runs through CopilotKit's real rendering path with no backend.
 * Each run plays one scene, chosen by `forwardedProps.scene`.
 */
export type DemoScene =
  | { scene: "request"; variant: "over_cap" | "learned" }
  | { scene: "decision"; requestId: string; outcome: "approved" | "rejected"; note?: string }
  | { scene: "learn" }
  | { scene: "fields_edited"; requestId: string; fields: EditableField[] };

const PRICING_FIELDS: EditableField[] = ["nightlyRate", "city", "checkIn", "checkOut"];

export class ScriptedExpenseAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            timers.delete(t);
            resolve();
          }, ms);
          timers.add(t);
        });
      const emit = (event: BaseEvent) => {
        if (!cancelled) subscriber.next(event);
      };

      const scene = new Scene(input, emit, sleep);
      (async () => {
        emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
        await scene.play((input.forwardedProps ?? {}) as DemoScene);
        emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
        if (!cancelled) subscriber.complete();
      })().catch((err) => subscriber.error(err));

      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    });
  }
}

class Scene {
  private state: ExpenseDeskState;
  private emit: (e: BaseEvent) => void;
  private sleep: (ms: number) => Promise<void>;

  constructor(input: RunAgentInput, emit: (e: BaseEvent) => void, sleep: (ms: number) => Promise<void>) {
    this.emit = emit;
    this.sleep = sleep;
    this.state = structuredClone({ ...emptyDeskState(), ...(input.state ?? {}) }) as ExpenseDeskState;
  }

  async play(props: DemoScene) {
    switch (props.scene) {
      case "request":
        return this.request(props.variant);
      case "decision":
        return this.decision(props.requestId, props.outcome, props.note);
      case "learn":
        return this.learn();
      case "fields_edited":
        return this.fieldsEdited(props.requestId, props.fields);
    }
  }

  /* ---------------- scenes ---------------- */

  private async request(variant: "over_cap" | "learned") {
    const id = this.nextRequestId();
    const now = new Date().toISOString();
    const draft: ExpenseRequest =
      variant === "over_cap"
        ? {
            id,
            createdAt: now,
            source: {
              channel: "teams",
              text: "I need to book a hotel in London for the AI Summit, 4 to 7 Nov, around £320 a night.",
            },
            requester: { name: "Amara Nwosu" },
            category: "hotel",
            city: "London",
            purpose: "AI Summit",
            nightlyRate: 320,
            nights: 3,
            checkIn: "2026-11-04",
            checkOut: "2026-11-07",
            currency: "GBP",
            status: "received",
          }
        : {
            id,
            createdAt: now,
            source: {
              channel: "teams",
              text: "Booking London again for the AI Summit follow-up workshop, 18 to 20 Nov, £335 a night.",
            },
            requester: { name: "Amara Nwosu" },
            category: "hotel",
            city: "London",
            purpose: "AI Summit workshop",
            nightlyRate: 335,
            nights: 2,
            checkIn: "2026-11-18",
            checkOut: "2026-11-20",
            currency: "GBP",
            status: "received",
          };

    this.state.requests = [draft, ...this.state.requests];
    this.state.activeRequestId = id;
    this.snapshot();
    await this.sleep(1100);

    this.patch(id, { status: "checking" });
    await this.sleep(500);

    // 1. Directory lookup
    const emp = findEmployeeByName(draft.requester.name)!;
    const lookup: LookupEmployeeResult = {
      employee: { ...personRef(emp.id), costCenter: emp.costCenter },
      manager: personRef(emp.managerId!),
    };
    await this.tool<LookupEmployeeArgs>(TOOL.lookupEmployee, { requestId: id, name: draft.requester.name }, lookup, 900);
    this.patch(id, {
      employeeId: emp.id,
      managerId: emp.managerId,
      employee: lookup.employee,
      manager: lookup.manager,
      costCenter: emp.costCenter,
    });
    await this.sleep(600);

    // 2. Policy check, which may cite a learned rule
    const current = this.find(id);
    const policy = evaluatePolicy(current, this.state.learnedRules);
    await this.tool<CheckPolicyArgs>(
      TOOL.checkPolicy,
      { requestId: id, category: "hotel", city: current.city, nightlyRate: current.nightlyRate, nights: current.nights },
      policy,
      1000,
    );
    this.patch(id, { policy });
    await this.sleep(700);

    const first = current.requester.name.split(" ")[0];
    if (policy.outcome === "over") {
      // 3a. Over the cap: hand to the manager in Teams and pause
      const manager = lookup.manager;
      await this.tool<SubmitApprovalArgs>(
        TOOL.submitApprovalRequest,
        { requestId: id, managerId: manager.id, channel: "teams" },
        { status: "sent", cardId: `card_${id.toLowerCase()}` },
        1100,
      );
      this.patch(id, {
        status: "awaiting_manager",
        approval: { managerId: manager.id, sentAt: new Date().toISOString(), channel: "teams", card: cardFacts(this.find(id)) },
      });
      await this.sleep(400);
      await this.say(
        `Thanks ${first}. £${current.nightlyRate} a night is £${policy.overBy} over the London cap, so I've sent it to ${manager.name.split(" ")[0]} to approve. I'll message you as soon as there's a decision.`,
      );
    } else {
      // 3b. Within policy or a learned limit: approve on the agent's own authority
      const learnedRuleId = policy.learnedRule?.id;
      await this.tool<RecordDecisionArgs>(
        TOOL.recordDecision,
        { requestId: id, outcome: "approved", decidedBy: "agent", ...(learnedRuleId ? { learnedRuleId } : {}) },
        { status: "recorded" },
        700,
      );
      this.patch(id, {
        status: "auto_approved",
        decision: { outcome: "approved", by: "agent", at: new Date().toISOString(), channel: "agent", learnedRuleId },
      });
      await this.sleep(400);
      await this.say(
        learnedRuleId
          ? `You're all set, ${first}. Managers have approved London hotels up to £${policy.learnedRule!.capPerNight} a night, so I approved this one directly under learned rule ${learnedRuleId}.`
          : `You're all set, ${first}. That's within policy, so it's approved.`,
      );
    }
  }

  private async decision(requestId: string, outcome: "approved" | "rejected", note?: string) {
    const r = this.find(requestId);
    const managerId = r.managerId ?? r.approval?.managerId ?? "jonas.lindqvist";
    this.state.activeRequestId = requestId;
    await this.sleep(300);
    await this.tool<RecordDecisionArgs>(
      TOOL.recordDecision,
      { requestId, outcome, decidedBy: managerId, ...(note ? { note } : {}) },
      { status: "recorded" },
      700,
    );
    this.patch(requestId, {
      status: outcome,
      decision: { outcome, by: managerId, at: new Date().toISOString(), channel: "teams", note },
    });
    await this.sleep(400);
    const first = r.requester.name.split(" ")[0];
    const manager = directory[managerId]?.name.split(" ")[0] ?? "Your manager";
    const rateEdit = r.edits?.find((e) => e.field === "nightlyRate");
    const adjusted = rateEdit ? ` Finance adjusted the rate from £${rateEdit.from}.` : "";
    await this.say(
      outcome === "approved"
        ? `Good news, ${first}: ${manager} approved your ${r.city} hotel at £${r.nightlyRate} a night (£${totalOf(r).toLocaleString("en-GB")}).${adjusted} It's logged against ${r.costCenter ?? "your cost centre"}.`
        : `${manager} didn't approve this one, ${first}.${note ? ` Their note: "${note}"` : ""}`,
    );
  }

  private async learn() {
    // Automatic Learning runs outside the agent turn; the agent publishes the
    // skills it loaded through SkillRegistryContextProvider into shared state.
    const evidence = this.state.requests.filter(
      (r) =>
        r.city.toLowerCase() === "london" &&
        r.status === "approved" &&
        r.decision?.by !== "agent" &&
        r.policy?.outcome === "over",
    );
    if (evidence.length === 0) return;
    // The limit is the highest rate managers actually approved, never more
    // than 50% above the written cap (seed/expense-policy.md).
    const base = baseRuleFor("London").capPerNight;
    const cap = Math.min(Math.max(...evidence.map((r) => r.nightlyRate)), base * 1.5);
    await this.sleep(900);
    this.state.learnedRules = [
      {
        id: "LR-01",
        title: `London hotels are approved up to £${cap} a night`,
        category: "hotel",
        city: "London",
        capPerNight: cap,
        learnedAt: new Date().toISOString(),
        source: "automatic_learning",
        evidence: {
          approvals: evidence.length,
          requestIds: evidence.map((r) => r.id),
          approverIds: [...new Set(evidence.map((r) => r.decision!.by))],
          rates: evidence.map((r) => r.nightlyRate),
        },
      },
    ];
    this.snapshot();
  }

  private async fieldsEdited(requestId: string, fields: EditableField[]) {
    const r = this.find(requestId);
    if (!isOpen(r)) return;
    if (fields.some((f) => PRICING_FIELDS.includes(f))) {
      const policy = evaluatePolicy(r, this.state.learnedRules);
      await this.tool<CheckPolicyArgs>(
        TOOL.checkPolicy,
        { requestId, category: r.category, city: r.city, nightlyRate: r.nightlyRate, nights: r.nights },
        policy,
        600,
      );
      this.patch(requestId, { policy });
    } else {
      await this.sleep(400);
    }
    if (r.status === "awaiting_manager" && r.approval) {
      // Refresh the manager's Adaptive Card with the edited facts.
      await this.sleep(300);
      const card = cardFacts(this.find(requestId));
      const changed = (Object.keys(card) as (keyof ApprovalCardFacts)[]).filter((k) => card[k] !== r.approval!.card[k]);
      this.patch(requestId, {
        approval: { ...r.approval, card, changed, updatedAt: new Date().toISOString() },
      });
    }
  }

  /* ---------------- event helpers ---------------- */

  private snapshot() {
    this.emit({ type: EventType.STATE_SNAPSHOT, snapshot: structuredClone(this.state) } as BaseEvent);
  }

  private find(id: string) {
    const r = this.state.requests.find((x) => x.id === id);
    if (!r) throw new Error(`Unknown request ${id}`);
    return r;
  }

  private patch(id: string, patch: Partial<ExpenseRequest>) {
    this.state.requests = this.state.requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.snapshot();
  }

  private nextRequestId() {
    const max = Math.max(2036, ...this.state.requests.map((r) => Number(r.id.replace(/\D/g, "")) || 0));
    return `EXP-${max + 1}`;
  }

  /** Streams a tool call's arguments in chunks, then its result. */
  private async tool<A extends object>(name: string, args: A, result: unknown, executeMs: number) {
    const toolCallId = `call_${crypto.randomUUID().slice(0, 8)}`;
    this.emit({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: name,
      parentMessageId: `msg_${crypto.randomUUID().slice(0, 8)}`,
    } as BaseEvent);
    const json = JSON.stringify(args);
    const size = Math.ceil(json.length / 5);
    for (let i = 0; i < json.length; i += size) {
      this.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: json.slice(i, i + size) } as BaseEvent);
      await this.sleep(90);
    }
    this.emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
    await this.sleep(executeMs);
    this.emit({
      type: EventType.TOOL_CALL_RESULT,
      messageId: `tool_${crypto.randomUUID().slice(0, 8)}`,
      toolCallId,
      content: JSON.stringify(result),
      role: "tool",
    } as BaseEvent);
  }

  /** Streams an assistant reply (what the employee sees in Teams). */
  private async say(text: string) {
    const messageId = `msg_${crypto.randomUUID().slice(0, 8)}`;
    this.emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
    const words = text.split(/(?<= )/);
    for (let i = 0; i < words.length; i += 3) {
      this.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: words.slice(i, i + 3).join("") } as BaseEvent);
      await this.sleep(45);
    }
    this.emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
  }
}

function cardFacts(r: ExpenseRequest): ApprovalCardFacts {
  const policy = r.policy ?? evaluatePolicy(r, []);
  return {
    requesterName: r.employee?.name ?? r.requester.name,
    city: r.city,
    purpose: r.purpose,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights: r.nights,
    nightlyRate: r.nightlyRate,
    total: totalOf(r),
    costCenter: r.costCenter,
    ruleId: policy.ruleId,
    capPerNight: policy.capPerNight,
    overBy: Math.max(0, r.nightlyRate - policy.capPerNight),
  };
}
