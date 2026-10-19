# Contoso Expense Desk

A Microsoft Agent Framework expense agent that works in Teams, with a CopilotKit finance dashboard that shows the agent working live.

| Path | What it is |
| --- | --- |
| `web/` | Finance dashboard: React + Vite + CopilotKit v2 (`@copilotkit/react-core/v2`). Tool calls render as generative UI; request fields are editable shared state. |
| `agent/` | The backend: a Microsoft Agent Framework agent (.NET 10) served over AG-UI, behind the CopilotKit .NET runtime and connected to CopilotKit Intelligence. See [`agent/README.md`](agent/README.md). |
| `design/moodboard.html` | The moodboard and design direction. Serve with `python3 -m http.server 4610 --directory design`. The third-party product screenshots it references are internal design references and aren't in the repo. |
| `design/capture_states.py` | Walks the demo and screenshots every state (used for design reviews in `design/review/`). |
| `design/render_card.py` | Expands and renders `cards/approval-request.json` with Microsoft's Adaptive Cards SDK (run `npm --prefix design/tools install` once). |
| `docs/agent-contract.md` | What the .NET agent must publish over AG-UI for the dashboard to work. |
| `cards/` | Adaptive Card templates: manager approval and employee request summary. |
| `seed/` | Expense policy, employees and managers, and past requests, shared by both sides. |
| `deploy/` | Deployment for testers: Railway runbook, web and agent Dockerfiles, smoke test. See [`deploy/README.md`](deploy/README.md). |
| `film/` | The launch film *Approvals That Learn*: storyboard spec (`film/spec/`), desk capture (`film/capture/`), Remotion project and synthesised score (`film/studio/`), and cuts (`film/versions/`). |

## Run the dashboard

```bash
npm --prefix web install
npm --prefix web run dev -- --port 4620
```

With no `VITE_COPILOTKIT_RUNTIME_URL`, a scripted AG-UI agent plays the demo through CopilotKit's normal rendering path. Press **D** for presenter controls, or use the keys directly:

| Key | Step |
| --- | --- |
| 1 | Amara asks for a London hotel at £320 a night (over the £250 cap) |
| 2 | Jonas approves in Teams (the panel also has Reject) |
| 3 | Automatic Learning learns "London hotels up to £350" |
| 4 | Amara asks again at £335; the agent approves it and cites the learned rule |
| R | Reset to seed data |

The on-screen hint for these keys only shows with `?presenter` in the URL, so recordings stay clean. Click any value in **Details** while a request is open to edit it; the agent re-checks policy and refreshes the manager's card.

## Run with the real agent

```bash
cp agent/.env.example agent/.env    # Azure OpenAI / Foundry and CopilotKit Intelligence; op:// references work
agent/run.sh                        # agent + CopilotKit runtime on http://localhost:5000
VITE_COPILOTKIT_RUNTIME_URL=http://localhost:5000/copilotkit npm --prefix web run dev -- --port 4620
```

The same keys drive the real agent: until the Teams channel exists, the presenter panel sends what Teams would (Amara's message, Jonas's button press). [`agent/README.md`](agent/README.md) covers every environment variable, what the model decides versus what the code enforces, learned skills, and what the Teams step still needs.

## Deploy

Hosting is on Railway; the runbook is [`deploy/README.md`](deploy/README.md).

- **Demo mode** (one `web` service): the production build with the scripted agent, presenter controls open on load (`VITE_SHOW_DEMO_CONTROLS=true`), optional basic auth (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`).
- **Live mode** (`web` + private `agent` service): the dashboard reaches the .NET runtime through the web host's `/copilotkit` proxy. Model and Intelligence secrets go on the agent service only. Anything named `VITE_*` ends up in the public JavaScript bundle, so it must never hold a secret.
- `deploy/railway-up.sh web|agent` deploys a service; `deploy/smoke.sh <url>` checks a deployment.
