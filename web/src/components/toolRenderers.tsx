import { ToolCallStatus, type ReactToolCallRenderer } from "@copilotkit/react-core/v2";
import {
  AGENT_ID,
  TOOL,
  type CheckPolicyArgs,
  type CheckPolicyResult,
  type LookupEmployeeArgs,
  type LookupEmployeeResult,
  type RecordDecisionArgs,
  type SubmitApprovalArgs,
} from "../agent/contract";
import { useRequest } from "../desk/DeskProvider";
import { useCallPosition } from "../desk/repeat";
import { parseJson } from "../desk/timeline";
import { ApprovalStep, DecisionStep, LookupStep, PolicyStep, type ToolInfo } from "./steps";

/**
 * Generative UI for the agent's tool calls. CopilotKit hands each renderer the
 * streaming args, the status and the result; the request itself comes from
 * shared state so a step can reflect what happened after the call (e.g. the
 * approval card collapses once the manager decides).
 */
type RenderProps<A> = {
  name: string;
  toolCallId: string;
  args: Partial<A>;
  status: ToolCallStatus;
  result?: string;
};

function toolInfo<A>({ name, args, status, result }: RenderProps<A>): ToolInfo {
  return status === ToolCallStatus.Complete ? { name, args, result: parseJson(result) ?? result } : { name };
}

function LookupRenderer(props: RenderProps<LookupEmployeeArgs>) {
  const r = parseJson<LookupEmployeeResult>(props.result);
  return (
    <LookupStep
      name={props.args.name}
      employee={r?.employee}
      manager={r?.manager}
      done={props.status === ToolCallStatus.Complete}
      tool={toolInfo(props)}
    />
  );
}

function PolicyRenderer(props: RenderProps<CheckPolicyArgs>) {
  const { repeat, superseded } = useCallPosition();
  return (
    <PolicyStep
      args={props.args}
      result={parseJson<CheckPolicyResult>(props.result)}
      done={props.status === ToolCallStatus.Complete}
      recheck={repeat}
      superseded={superseded}
      tool={toolInfo(props)}
    />
  );
}

function ApprovalRenderer(props: RenderProps<SubmitApprovalArgs>) {
  const request = useRequest(props.args.requestId);
  if (!request) return null;
  return <ApprovalStep request={request} done={props.status === ToolCallStatus.Complete} tool={toolInfo(props)} />;
}

function DecisionRenderer(props: RenderProps<RecordDecisionArgs>) {
  const request = useRequest(props.args.requestId);
  if (!request) return null;
  const { args } = props;
  return (
    <DecisionStep
      request={request}
      outcome={args.outcome}
      decidedBy={args.decidedBy}
      learnedRuleId={args.learnedRuleId}
      note={args.note}
      done={props.status === ToolCallStatus.Complete}
      tool={toolInfo(props)}
    />
  );
}

const asRenderer = <A,>(name: string, render: (p: RenderProps<A>) => React.ReactElement | null) =>
  ({ name, agentId: AGENT_ID, render }) as unknown as ReactToolCallRenderer<A>;

export const toolRenderers: ReactToolCallRenderer<unknown>[] = [
  asRenderer(TOOL.lookupEmployee, LookupRenderer),
  asRenderer(TOOL.checkPolicy, PolicyRenderer),
  asRenderer(TOOL.submitApprovalRequest, ApprovalRenderer),
  asRenderer(TOOL.recordDecision, DecisionRenderer),
] as ReactToolCallRenderer<unknown>[];
