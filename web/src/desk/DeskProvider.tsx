import { useAgent, useCopilotKit, type Message } from "@copilotkit/react-core/v2";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AGENT_ID,
  emptyDeskState,
  type EditableField,
  type ExpenseDeskState,
  type FieldEdit,
  type ExpenseRequest,
} from "../agent/contract";
import type { DemoScene } from "../agent/scripted-agent";
import { financeUser } from "../agent/seed";
import { nightsBetween } from "../lib/format";

interface DeskContextValue {
  desk: ExpenseDeskState;
  messages: Message[];
  isRunning: boolean;
  selectedId: string | null;
  select: (id: string | null) => void;
  selected: ExpenseRequest | undefined;
  /** Queues an agent run so demo steps and field edits never overlap. */
  run: (props?: DemoScene | Record<string, unknown>) => Promise<void>;
  /** Finance edits a field: write shared state, then let the agent react. */
  editRequest: (id: string, field: EditableField, value: string | number) => void;
  /** Field edits whose agent re-check has not finished yet. */
  syncing: boolean;
  /** Set briefly after the agent finishes reacting to an edit. */
  justSynced: boolean;
  /** A rule Automatic Learning just produced, shown once until the agent moves on. */
  announcedRuleId: string | null;
  dismissAnnouncement: () => void;
  reset: (state: ExpenseDeskState) => void;
}

const DeskContext = createContext<DeskContextValue | null>(null);

/** Connected to the CopilotKit runtime and the .NET agent, rather than the scripted agent. */
const runtimeMode = Boolean(import.meta.env.VITE_COPILOTKIT_RUNTIME_URL);

/**
 * Until the Teams channel is wired, the presenter's "employee asks" steps send
 * the agent what Teams would: the employee's message, with their display name
 * in forwardedProps.from. Same text as the scripted agent's scenes.
 */
const TEAMS_MESSAGES = {
  over_cap: {
    from: "Amara Nwosu",
    text: "I need to book a hotel in London for the AI Summit, 4 to 7 Nov, around £320 a night.",
  },
  learned: {
    from: "Amara Nwosu",
    text: "Booking London again for the AI Summit follow-up workshop, 18 to 20 Nov, £335 a night.",
  },
} as const;

export function DeskProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __expenseAgent: unknown }).__expenseAgent = agent;
  }, [agent]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const syncedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const desk: ExpenseDeskState = { ...emptyDeskState(), ...(agent.state ?? {}) };

  const run = useCallback(
    (props?: DemoScene | Record<string, unknown>) => {
      setPending((n) => n + 1);
      const next = queue.current
        .then(() => {
          if (runtimeMode && props?.scene === "request") {
            const message = TEAMS_MESSAGES[(props as Extract<DemoScene, { scene: "request" }>).variant];
            agent.addMessage({ id: crypto.randomUUID(), role: "user", content: message.text });
            return copilotkit.runAgent({ agent, forwardedProps: { scene: "teams_message", from: message.from } });
          }
          return copilotkit.runAgent({ agent, forwardedProps: props as Record<string, unknown> });
        })
        .then(() => undefined)
        .catch((err) => console.error("[expense-desk] agent run failed", err))
        .finally(() => setPending((n) => n - 1));
      queue.current = next;
      return next;
    },
    [agent, copilotkit],
  );

  // Follow the agent: when it starts work on a request, open it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (desk.activeRequestId && desk.activeRequestId !== lastActive.current) {
      lastActive.current = desk.activeRequestId;
      setSelectedId(desk.activeRequestId);
    }
  }, [desk.activeRequestId]);

  const editRequest = useCallback(
    (id: string, field: EditableField, value: string | number) => {
      const state = { ...emptyDeskState(), ...(agent.state ?? {}) } as ExpenseDeskState;
      const at = new Date().toISOString();
      const afterMessageId = agent.messages.at(-1)?.id;
      let edit: FieldEdit | undefined;
      const requests = state.requests.map((r) => {
        if (r.id !== id) return r;
        edit = { field, from: r[field] ?? "", to: value, by: financeUser.id, at, afterMessageId };
        const next: ExpenseRequest = { ...r, [field]: value, edits: [...(r.edits ?? []), edit] };
        if (field === "checkIn" || field === "checkOut") {
          next.nights = nightsBetween(next.checkIn, next.checkOut) ?? next.nights;
        }
        return next;
      });
      agent.setState({ ...state, requests });
      setSyncing(true);
      setJustSynced(false);
      // The value and its edit record travel with the run too, so a state
      // snapshot that lands while the edit waits in the queue can't erase it.
      const values = { [field]: value };
      run({ scene: "fields_edited", requestId: id, fields: [field], values, edits: edit ? [edit] : [] }).finally(() => {
        setSyncing(false);
        setJustSynced(true);
        clearTimeout(syncedTimer.current);
        syncedTimer.current = setTimeout(() => setJustSynced(false), 3200);
      });
    },
    [agent, run],
  );

  // The .NET agent owns the desk: load it once the runtime hands over the real
  // agent (useAgent returns a throwaway stand-in while it connects).
  const synced = useRef(false);
  const connected = runtimeMode && copilotkit.getAgent(AGENT_ID) === agent;
  useEffect(() => {
    if (!connected || synced.current) return;
    synced.current = true;
    void run({ scene: "sync" });
  }, [connected, run]);

  const reset = useCallback(
    (state: ExpenseDeskState) => {
      agent.setMessages([]);
      lastActive.current = null;
      setSelectedId(null);
      // The real agent resets its own desk to seed/; the scripted one takes the state given.
      if (runtimeMode) void run({ scene: "reset" });
      else agent.setState(state);
    },
    [agent, run],
  );

  // Announce a learned rule the first time it appears, until the agent starts on the next request.
  const [announcedRuleId, setAnnouncedRuleId] = useState<string | null>(null);
  const knownRules = useRef<Set<string> | null>(null);
  const activeAtAnnounce = useRef<string | null>(null);
  const ruleIds = desk.learnedRules.map((r) => r.id).join(",");
  // Against the real agent the desk arrives with the first sync; rules it already
  // had then are not news. (The scripted agent starts with the seed in place.)
  const deskLoaded = !runtimeMode || desk.requests.length > 0;
  useEffect(() => {
    if (!deskLoaded) return;
    const ids = ruleIds ? ruleIds.split(",") : [];
    if (knownRules.current === null) {
      knownRules.current = new Set(ids);
      return;
    }
    const added = ids.find((id) => !knownRules.current!.has(id));
    knownRules.current = new Set(ids);
    if (added) {
      activeAtAnnounce.current = desk.activeRequestId;
      setAnnouncedRuleId(added);
    } else if (!ids.length) {
      setAnnouncedRuleId(null);
    }
  }, [ruleIds, desk.activeRequestId, deskLoaded]);
  useEffect(() => {
    if (announcedRuleId && desk.activeRequestId !== activeAtAnnounce.current) setAnnouncedRuleId(null);
  }, [desk.activeRequestId, announcedRuleId]);
  const dismissAnnouncement = useCallback(() => setAnnouncedRuleId(null), []);

  const selected = desk.requests.find((r) => r.id === selectedId);

  const value: DeskContextValue = {
    desk,
    messages: agent.messages,
    isRunning: agent.isRunning || pending > 0,
    selectedId,
    select: setSelectedId,
    selected,
    run,
    editRequest,
    syncing,
    justSynced,
    announcedRuleId,
    dismissAnnouncement,
    reset,
  };

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used inside <DeskProvider>");
  return ctx;
}

export function useRequest(id: string | undefined) {
  const { desk } = useDesk();
  return id ? desk.requests.find((r) => r.id === id) : undefined;
}
