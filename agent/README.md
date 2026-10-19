# Expense agent (.NET)

The backend for the Contoso Expense Desk: a Microsoft Agent Framework agent, served over AG-UI, behind the CopilotKit .NET runtime and connected to a CopilotKit Intelligence project. One ASP.NET Core host (.NET 10) serves everything:

| Route | What it is |
| --- | --- |
| `POST /agents/expense` | The `expense` agent over AG-UI (`AGUI.Server` 1.0.1 through Agent Framework's `MapAGUIServer`). |
| `/copilotkit/*` | The CopilotKit .NET runtime (`CopilotKit.Intelligence.Runtime` 0.1.0-rc.1). The dashboard talks to this. It reaches the agent through `HttpAgent` and sends every event to Intelligence, which stores the thread and streams it to the browser. |
| `GET /healthz` | `{"status":"ok","runtime":…,"model":…,"learnedSkills":…}`: which parts are configured. `GET /` returns the same as plain text. |

```
dashboard ──▶ /copilotkit (CopilotKit runtime) ──HttpAgent──▶ /agents/expense (MAF agent) ──▶ Azure OpenAI / Foundry
                    │                                              └─ learned skills ◀── CopilotKit Intelligence
                    └─ events ──▶ CopilotKit Intelligence ──websocket──▶ dashboard
```

| Path | What it is |
| --- | --- |
| `ExpenseDesk/Agent/ExpenseAgent.cs` | The agent: reads the Teams message into a request, runs the model with the four tools, publishes `ExpenseDeskState` as `STATE_SNAPSHOT`s, re-checks policy after Finance edits. |
| `ExpenseDesk/Agent/ExpenseTools.cs` | `lookup_employee`, `check_policy`, `submit_approval_request`, `record_decision`, exactly as in `docs/agent-contract.md`. |
| `ExpenseDesk/Desk/` | Contract types (mirror `web/src/agent/contract.ts`), seed loading, the policy, and the agent's copy of the desk. |
| `ExpenseDesk/Learning/LearnedSkills.cs` | Turns learned skills from Intelligence into `learnedRules`. |
| `ExpenseDesk/Program.cs` | Host wiring: model, Intelligence client, `SkillRegistryContextProvider`, runtime. |
| `ExpenseDesk.Tests/` | The full flow through the HTTP endpoint with a scripted model; no network. |

## Setup

1. **.NET 10 SDK.** This Mac has it in `~/.dotnet` (installed with Microsoft's script, no admin rights). Elsewhere:

   ```bash
   curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0 --install-dir "$HOME/.dotnet"
   ```

2. **Settings.** Copy `agent/.env.example` to `agent/.env` and fill it in. For Intelligence, the CopilotKit CLI creates the project, its API key and the Learning Container (commands in `.env.example`). Keep the key in your password manager and put only its reference in `.env`. Values can be 1Password references (`op://vault/item/field`); `run.sh` resolves them with `op run`, so keys never sit on disk in plain text. `agent/.env` is git-ignored.

3. **Start the agent and runtime** on http://localhost:5000:

   ```bash
   agent/run.sh
   ```

   With `op://` references in `agent/.env`, 1Password asks you to unlock once.

   The log (and `/healthz`) says which parts are on. Without a model it still serves state and edits. **Without `CPK_INTELLIGENCE_API_KEY` there is no `/copilotkit` at all**: requests to it return 404 and the dashboard can't connect.

4. **Start the dashboard against it:**

   ```bash
   VITE_COPILOTKIT_RUNTIME_URL=http://localhost:5000/copilotkit npm --prefix web run dev -- --port 4620
   ```

   Add `VITE_COPILOTKIT_LICENSE_KEY=…` if your CopilotKit project has a public license key. Open http://localhost:4620 and press **D**. Until the Teams channel exists, the presenter panel stands in for Teams: step 1 sends Amara's message to the real agent, step 2 is Jonas pressing Approve on the card, step 3 re-reads the learned skills, step 4 is Amara's second request, **R** resets the agent's desk to `seed/`.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `AZURE_OPENAI_ENDPOINT` | for the model | Azure OpenAI (`https://<resource>.openai.azure.com`) or Foundry (`https://<resource>.services.ai.azure.com`) resource. `/openai/v1/` is appended. |
| `AZURE_OPENAI_DEPLOYMENT` | for the model | A chat-completions deployment that supports tool calling and structured output. |
| `AZURE_OPENAI_API_KEY` | no | Without it the agent signs in with Entra ID (`DefaultAzureCredential`). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | no | Stand-in model until an Azure deployment exists: OpenAI's API through the same SDK path (default model `gpt-5.6-sol`). Ignored when the Azure variables are set. |
| `MODEL_REASONING_EFFORT` | no | `reasoning_effort` on every model call. gpt-5.6 models refuse function tools on Chat Completions unless it's `none`, so the OpenAI stand-in defaults to `none`; for an Azure reasoning deployment set what it accepts (e.g. `minimal`). |
| `CPK_INTELLIGENCE_API_KEY` | for the dashboard | Server-side Intelligence API key. Turns on `/copilotkit`. |
| `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID` | for learning | The Learning Container. New threads are assigned to it, and the agent loads its skills. |
| `INTELLIGENCE_API_URL`, `INTELLIGENCE_RUNNER_URL`, `INTELLIGENCE_CLIENT_URL` | no | Only for a non-default Intelligence deployment. |
| `CPK_INTELLIGENCE_SKILLS_REVISION` | no | Pin one learned-skills revision. |
| `DESK_ALLOWED_ORIGINS` | no | Browser origins allowed to call `/copilotkit` (default `http://localhost:4620`, comma-separated). |
| `DESK_AGENT_URL` | no | Where the runtime reaches the agent (default `http://localhost:5000/agents/expense`). |
| `DESK_DEMO_USER_ID`, `DESK_DEMO_USER_NAME` | no | The user every runtime request runs as (default Priya Raman, Finance). |
| `DESK_SEED_DIR` | no | The `seed/` folder (default: the repo's). |

## How a run works

Each run says what started it in AG-UI `forwardedProps.scene`:

| Scene | Sent by | What the agent does |
| --- | --- | --- |
| `teams_message` (`from`, plus the employee's text as the last user message) | Teams (today the presenter panel) | Reads the message into a new request (`received`), then the model calls `lookup_employee` → `check_policy` → `submit_approval_request` or `record_decision`, and writes the reply to the employee. |
| `decision` (`requestId`, `outcome`, `note?`, `decidedBy?`) | The manager's Approve / Reject on the Teams card | The model records the manager's decision with `record_decision` and tells the employee. |
| `fields_edited` (`requestId`, `fields`) | The dashboard after Finance edits a value | Takes the edited fields from the run's state, re-runs `check_policy` if a pricing field changed, and refreshes the manager's card facts (`approval.card`, `approval.changed`, `approval.updatedAt`). No model call, so it syncs in well under a second. |
| `learn` | Presenter step 3 | Re-reads the learned skills now and publishes `learnedRules`. |
| `sync` | The dashboard on load | Publishes the desk. |
| `reset` | Presenter **R** | Puts the desk back to `seed/`. |

What the model decides and what the code enforces:

- The model chooses the tool calls and writes every reply. The tools enforce the rules: `check_policy` only accepts the request's real values, only an over-cap request can go to the manager, the agent can only approve within policy or under the learned rule `check_policy` applied, and a manager's decision is only recorded when one actually arrived (`decision` scene). A rejected call returns `{ "error": … }` to the model, which corrects itself.
- The agent owns the desk (`ExpenseDeskState`, seeded from `seed/`), because runs that start in Teams carry no browser state. From the dashboard it only accepts Finance's edits to the six editable fields of an open request.
- Every state change goes out as a `STATE_SNAPSHOT` just before the matching `TOOL_CALL_RESULT`, so status pills never lag behind the timeline.
- Text the model writes before its first tool call is held back, so a preamble can't land under the previous request in the dashboard.

### Learned skills

`SkillRegistryContextProvider` (`CopilotKit.Intelligence.AgentFramework`) wraps the model agent: each run gets the Learning Container's skill catalog and the `copilotkit_load_skill` / `copilotkit_read_skill_file` tools. Those two calls stay on the server and never reach the dashboard.

The adapter keeps its snapshot private, so `LearnedSkills` reads the same container's published snapshot with the Intelligence SDK (`GetLearnedSkillsSnapshotAsync`) and turns each hotel-cap skill into a `learnedRules` entry:

- **id:** the skill name.
- **city and cap:** read from the skill's text. A `city:` / `capPerNight:` line wins; otherwise the first city named and the "up to £…" amount.
- **ceiling:** the policy's 50% limit applies.
- **evidence:** the managers' approvals on the desk that the rule covers.

`check_policy` applies those rules, so the decision itself stays deterministic. A skill that isn't about raising a hotel cap is still there for the model, just not shown as a rule.

Automatic Learning works in stages inside Intelligence: threads in the container become **insights**, insights become skill **candidates**, and a candidate is only **published** (and loaded by the agent) once someone approves it. Step 3 only re-reads what has been published. From `agent/` (the CLI's project selection is in `agent/.copilotkit/project.json`):

```bash
npx copilotkit learning insights list contoso-expense-desk
npx copilotkit learning candidates list contoso-expense-desk
npx copilotkit learning candidates approve contoso-expense-desk <candidate-id>
npx copilotkit learning skills list contoso-expense-desk
```

The container's prompt context asks for skills with `city:` and `capPerNight:` lines, which `LearnedSkills` reads first. A published skill stays in the container across rehearsals and **R** doesn't remove it. Once it exists, step 1's £320 request is approved by the agent rather than sent to Jonas, unless you pin an older revision with `CPK_INTELLIGENCE_SKILLS_REVISION`.

## Tests

```bash
dotnet test agent/ExpenseDesk.slnx
```

The integration tests run the real host, tools and AG-UI stream with a scripted model in place of Azure OpenAI and no Intelligence connection. They check:

- the event order and state at each step
- that every tool's arguments start with `requestId`
- that no event carries an explicit null (which `@ag-ui/client` rejects)
- that the model can't decide for the manager
- edit re-checks and card refreshes
- the learned-rule approval
- reset

Set `DESK_DUMP_SSE=<dir>` to keep each run's SSE stream. The streams were also replayed through the dashboard's own `@ag-ui/client` `HttpAgent` (schema parse, verifier, state application) without errors.

## Limits of this build

- **Identity:** `IdentifyUser` returns the fixed demo user for every request. Put real sign-in (Entra ID) in front of `/copilotkit` before it leaves localhost. `/agents/expense` has no auth either; keep it private (localhost, or a private network as in `deploy/`).
- **Persistence:** the desk is in memory. Restarting the host goes back to `seed/`. Intelligence keeps the threads.
- **Streaming:** tool arguments arrive in one `TOOL_CALL_ARGS` chunk, after the model finishes the call. `AGUIStreamOptions.MapStreamingToolCallArguments` could stream them, but the skill tools would then need filtering in the extractor too.
- **Reasoning:** the agent drops reasoning content, because the CopilotKit runtime rejects `reasoning` messages on the next run.

## Not built yet: the Teams channel

Everything Teams-facing goes through the same two scenes the presenter panel sends today, so the agent doesn't change. One thing to check first: the org's runtime entitlements (`/copilotkit/info`) currently report `managed_channels: true` but `msteams: false`. The channel needs:

- **A bot.** An Azure Bot or Teams app registration (Entra app id and secret, messaging endpoint) and the CopilotKit Channels SDK listener (`@copilotkit/channels-teams` with `@copilotkit/channels-intelligence`). It turns an employee's message into a run on that conversation's Intelligence thread: the text as a user message, plus `forwardedProps: { scene: "teams_message", from: <display name> }`.
- **Identity mapping.** Map Teams users (AAD object id or UPN) to directory ids. `seed/people.json` needs an `aadObjectId` or `email` per person, so `lookup_employee` and `decidedBy` match real accounts.
- **Sending the card.** Send `cards/approval-request.json` to the manager when `submit_approval_request` runs (`ExpenseTools.SubmitApprovalRequestAsync` logs where it would). The template data is `approval.card`. Delivery needs a proactive message, so store a conversation reference for each manager.
- **Refreshing the card.** Update the sent card when Finance edits (`ExpenseAgent.FieldsEditedAsync`), using the activity id saved at send time.
- **The card's buttons.** `Action.Execute` `approve` / `reject` becomes a run with `forwardedProps: { scene: "decision", requestId, outcome, note, decidedBy: <manager's directory id> }`.
- **Replies.** Assistant text messages go back to the employee's conversation; `cards/request-summary.json` is optional.
- **Dashboard.** Attach to the Teams thread with `connectAgent` instead of starting runs itself (only `web/src/desk/DeskProvider.tsx` changes), and drop the presenter panel from live mode.
