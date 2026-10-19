/**
 * The contract between the expense agent (Microsoft Agent Framework on .NET,
 * served over AG-UI) and this dashboard. The .NET agent publishes
 * `ExpenseDeskState` as AG-UI shared state and calls the four tools below.
 * Field names are camelCase on the wire; see docs/agent-contract.md.
 */

export const AGENT_ID = "expense";

export const TOOL = {
  lookupEmployee: "lookup_employee",
  checkPolicy: "check_policy",
  submitApprovalRequest: "submit_approval_request",
  recordDecision: "record_decision",
} as const;

export type RequestStatus =
  | "received"
  | "checking"
  | "awaiting_manager"
  | "approved"
  | "rejected"
  | "auto_approved";

export interface PersonRef {
  id: string;
  name: string;
  title: string;
  department?: string;
}

export interface PolicyResult {
  ruleId: string;
  capPerNight: number;
  outcome: "within" | "over" | "within_learned";
  overBy?: number;
  /** Present when a learned rule decided the outcome. */
  learnedRule?: { id: string; capPerNight: number; title: string };
}

export interface Decision {
  outcome: "approved" | "rejected";
  /** Employee id of the manager, or "agent" for an automatic decision. */
  by: string;
  at: string;
  channel: "teams" | "agent";
  note?: string;
  learnedRuleId?: string;
}

export interface ExpenseRequest {
  id: string;
  createdAt: string;
  source: { channel: "teams"; text: string };
  /** Display name from the Teams message, before the directory lookup. */
  requester: { name: string };
  employeeId?: string;
  managerId?: string;
  employee?: PersonRef;
  manager?: PersonRef;
  category: "hotel";
  city: string;
  purpose: string;
  nightlyRate: number;
  nights: number;
  checkIn?: string;
  checkOut?: string;
  currency: "GBP";
  costCenter?: string;
  status: RequestStatus;
  policy?: PolicyResult;
  approval?: {
    managerId: string;
    sentAt: string;
    channel: "teams";
    /** Set when the agent refreshes the card after a Finance edit. */
    updatedAt?: string;
    /** Exactly what the agent put on the manager's Adaptive Card. */
    card: ApprovalCardFacts;
    /** Facts that changed in the latest refresh, so the preview can mark them. */
    changed?: (keyof ApprovalCardFacts)[];
  };
  decision?: Decision;
  /** Fields Finance changed in the dashboard, oldest first. */
  edits?: FieldEdit[];
}

export interface ApprovalCardFacts {
  requesterName: string;
  city: string;
  purpose: string;
  checkIn?: string;
  checkOut?: string;
  nights: number;
  nightlyRate: number;
  total: number;
  costCenter?: string;
  ruleId: string;
  capPerNight: number;
  overBy: number;
}

export interface FieldEdit {
  field: EditableField;
  from: string | number;
  to: string | number;
  by: string;
  at: string;
  /** Last agent message when the edit was made, so the timeline can place it. */
  afterMessageId?: string;
}

export type EditableField = "city" | "purpose" | "nightlyRate" | "checkIn" | "checkOut" | "costCenter";

export interface LearnedRule {
  id: string;
  title: string;
  category: "hotel";
  city: string;
  capPerNight: number;
  learnedAt: string;
  source: "automatic_learning";
  evidence: { approvals: number; requestIds: string[]; approverIds: string[]; rates: number[] };
}

export interface ExpenseDeskState {
  requests: ExpenseRequest[];
  learnedRules: LearnedRule[];
  people: Record<string, PersonRef>;
  /** The request the agent is working on now. The dashboard follows it. */
  activeRequestId: string | null;
}

/* ---------- tool arguments and results ---------- */

export interface LookupEmployeeArgs {
  requestId: string;
  name: string;
}
export interface LookupEmployeeResult {
  employee: PersonRef & { costCenter: string };
  manager: PersonRef;
}

export interface CheckPolicyArgs {
  requestId: string;
  category: "hotel";
  city: string;
  nightlyRate: number;
  nights: number;
}
export type CheckPolicyResult = PolicyResult;

export interface SubmitApprovalArgs {
  requestId: string;
  managerId: string;
  channel: "teams";
}
export interface SubmitApprovalResult {
  status: "sent";
  cardId: string;
}

export interface RecordDecisionArgs {
  requestId: string;
  outcome: "approved" | "rejected";
  decidedBy: string;
  learnedRuleId?: string;
  note?: string;
}
export interface RecordDecisionResult {
  status: "recorded";
}

/* ---------- helpers shared by the UI and the scripted agent ---------- */

export const OPEN_STATUSES: RequestStatus[] = ["received", "checking", "awaiting_manager"];

export function isOpen(r: ExpenseRequest) {
  return OPEN_STATUSES.includes(r.status);
}

export function totalOf(r: Pick<ExpenseRequest, "nightlyRate" | "nights">) {
  return r.nightlyRate * r.nights;
}

export function emptyDeskState(): ExpenseDeskState {
  return { requests: [], learnedRules: [], people: {}, activeRequestId: null };
}
