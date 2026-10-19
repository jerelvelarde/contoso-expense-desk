import type { Message, ToolCall, ToolMessage } from "@copilotkit/react-core/v2";
import type { FieldEdit } from "../agent/contract";

export type TimelineEntry =
  | { kind: "tool"; key: string; toolCall: ToolCall; toolMessage?: ToolMessage; requestId?: string }
  | { kind: "reply"; key: string; content: string; requestId?: string }
  | { kind: "edit"; key: string; edit: FieldEdit; requestId: string };

const REQUEST_ID = /"requestId"\s*:\s*"([^"]+)"/;

/**
 * Turns the agent's message stream into per-request timeline entries. Tool
 * calls carry `requestId` in their (possibly still streaming) arguments; a text
 * reply belongs to the request of the tool call that came before it.
 */
export function buildTimeline(messages: Message[], requestId: string, edits: FieldEdit[] = []): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const byToolCallId = new Map<string, Extract<TimelineEntry, { kind: "tool" }>>();
  let current: string | undefined;
  const editsAfter = (id: string | undefined) =>
    edits.forEach((edit, i) => {
      if (edit.afterMessageId === id) entries.push({ kind: "edit", key: `edit-${i}-${edit.at}`, edit, requestId });
    });

  editsAfter(undefined);
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const tc of m.toolCalls ?? []) {
        const rid = REQUEST_ID.exec(tc.function.arguments ?? "")?.[1];
        if (rid) current = rid;
        const entry = { kind: "tool" as const, key: tc.id, toolCall: tc, requestId: rid ?? current };
        byToolCallId.set(tc.id, entry);
        entries.push(entry);
      }
      const text = typeof m.content === "string" ? m.content.trim() : "";
      if (text) entries.push({ kind: "reply", key: m.id, content: text, requestId: current });
    } else if (m.role === "tool") {
      const entry = byToolCallId.get(m.toolCallId);
      if (entry) entry.toolMessage = m as ToolMessage;
    }
    editsAfter(m.id);
  }
  return entries.filter((e) => e.requestId === requestId);
}

export function parseJson<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
