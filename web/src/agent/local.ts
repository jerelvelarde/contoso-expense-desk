import { AGENT_ID } from "./contract";
import { ScriptedExpenseAgent } from "./scripted-agent";
import { seedDeskState } from "./seed";

/**
 * Module-level so the scripted agent (and the demo's progress) survives hot
 * reloads of the components that use it.
 */
export const localAgents = {
  [AGENT_ID]: new ScriptedExpenseAgent({ agentId: AGENT_ID, initialState: seedDeskState() }),
};
