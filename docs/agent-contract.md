# Agent ↔ Expense Desk contract

The finance dashboard (`web/`) renders whatever the expense agent publishes over AG-UI. The .NET Microsoft Agent Framework agent must produce exactly this; the scripted agent in `web/src/agent/scripted-agent.ts` is the reference implementation of the event stream. Types live in `web/src/agent/contract.ts`.

## Agent id

`expense`. The dashboard binds with `useAgent({ agentId: "expense" })`.

## Shared state (`ExpenseDeskState`)

Published with `STATE_SNAPSHOT` (or `STATE_DELTA`) whenever anything changes.

| Field | Meaning |
| --- | --- |
| `requests[]` | Every expense request, newest first is fine (the UI sorts by `createdAt`). |
| `learnedRules[]` | Skills the agent loaded from `SkillRegistryContextProvider` (CopilotKit Intelligence Automatic Learning). The UI announces a new `id` once. |
| `people` | `id → { id, name, title, department }` for anyone referenced in evidence. |
| `activeRequestId` | The request the agent is working on. The dashboard opens it automatically. |

A request moves through `received → checking → awaiting_manager → approved | rejected`, or `received → checking → auto_approved`. The dashboard derives every status pill, queue group and lock state from `status`, so set it before the matching tool call returns.

Finance can edit `city`, `purpose`, `checkIn`, `checkOut`, `nightlyRate` and `costCenter` while a request is open. The dashboard writes the edited state with `agent.setState` and then runs the agent with `forwardedProps: { scene: "fields_edited", requestId, fields }`. On that run the agent should re-run `check_policy` if a pricing field changed, and, if the request is `awaiting_manager`, refresh the manager's Adaptive Card and set `approval.updatedAt`.

## Tools (rendered as generative UI)

Every tool's arguments must start with `requestId` so the dashboard can attribute a call to a request while the arguments are still streaming.

| Tool | Arguments | Result |
| --- | --- | --- |
| `lookup_employee` | `{ requestId, name }` | `{ employee: {id,name,title,department,costCenter}, manager: {id,name,title} }` |
| `check_policy` | `{ requestId, category, city, nightlyRate, nights }` | `{ ruleId, capPerNight, outcome: "within" \| "over" \| "within_learned", overBy?, learnedRule?: {id,capPerNight,title} }` |
| `submit_approval_request` | `{ requestId, managerId, channel: "teams" }` | `{ status: "sent", cardId }` |
| `record_decision` | `{ requestId, outcome, decidedBy, learnedRuleId?, note? }` | `{ status: "recorded" }` |

`decidedBy` is the manager's employee id, or `"agent"` when the agent approves within policy or under a learned rule. When it uses a learned rule it must pass `learnedRuleId` and say so in its reply to the employee.

## Text messages

Assistant text messages are the agent's replies to the employee in Teams. The dashboard shows each one under the request whose tool call preceded it.

## Human-in-the-loop

`submit_approval_request` sends `cards/approval-request.json` to the manager and the run ends with the request `awaiting_manager`. The Teams card's `Action.Execute` (`approve` / `reject`) reaches the Channels SDK listener, which resumes the agent. The resumed run calls `record_decision` and updates state. The dashboard never decides on the manager's behalf.

## What starts a run (`forwardedProps.scene`)

The .NET agent (`agent/`) reads what started each run from `forwardedProps.scene`:

| Scene | Props | Meaning |
| --- | --- | --- |
| `teams_message` | `from` (Teams display name); the employee's text is the run's last user message | A new request from Teams. |
| `decision` | `requestId`, `outcome`, `note?`, `decidedBy?` | The manager pressed Approve or Reject on the card. |
| `fields_edited` | `requestId`, `fields` | Finance edited fields (state carries the new values). |
| `learn` | | Re-read the learned skills and publish `learnedRules`. |
| `sync` | | Publish the desk (the dashboard sends this on load). |
| `reset` | | Put the desk back to `seed/`. |

The agent owns the desk state, because runs that start in Teams carry no browser state. From the dashboard it accepts only Finance's edits.

## Switching the dashboard to the real agent

```
VITE_COPILOTKIT_RUNTIME_URL=http://localhost:5000/copilotkit
VITE_COPILOTKIT_LICENSE_KEY=…
VITE_INTELLIGENCE_DASHBOARD_URL=https://…   # optional, shows "Open in CopilotKit Intelligence"
```

Without `VITE_COPILOTKIT_RUNTIME_URL` the dashboard uses the scripted agent. In both modes the presenter controls stand in for Teams; against the real agent they send the scenes above. Setup for the backend is in `agent/README.md`.

## Not built yet

- **Watching runs that start in Teams.** For now the dashboard starts every run itself. With the real stack, the employee's Teams message starts the run through the Intelligence channel, so the dashboard has to attach to that thread (CopilotKit `connectAgent` against the Intelligence thread for the Teams conversation) instead of calling `runAgent`. The rendering code doesn't change; only `DeskProvider` does.
- The Teams channel and the Channels SDK listener. The .NET agent and the CopilotKit .NET runtime host are in `agent/`; `agent/README.md` lists what the Teams step needs.
