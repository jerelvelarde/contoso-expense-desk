# Deploying Contoso Expense Desk

Two ways to host the dashboard, both on [Railway](https://railway.com):

| Mode | What testers get | Services | Status |
| --- | --- | --- | --- |
| **Demo** | The scripted agent plays the whole demo in the browser. Presenter controls are open on load, so nobody needs to know the keys. | `web` | Ready to deploy |
| **Live** | The dashboard talks to the .NET Microsoft Agent Framework agent through the CopilotKit .NET runtime and CopilotKit Intelligence, with Azure OpenAI or Foundry as the model. | `web` + `agent` | Ready once `agent/ExpenseDesk` runs end to end |

Nothing here has been created on Railway yet. Every step below is yours to run.

```
Demo:  browser ──https──▶ web (deploy/web/server.mjs, basic auth) ──▶ web/dist (scripted agent)

Live:  browser ──https──▶ web ──/copilotkit/*──▶ agent.railway.internal:8080/copilotkit   (private network)
                                                    └─ CopilotKit runtime ─▶ 127.0.0.1:8080/agents/expense ─▶ Azure OpenAI / Foundry
                                                    └─ CopilotKit Intelligence (threads, Automatic Learning)
```

In live mode the `agent` service gets **no public domain**. The browser reaches the runtime through the web host's `/copilotkit` proxy, so:

- there is no cross-origin call, and basic auth on the web host also covers the agent;
- the runtime (which runs every request as the demo Finance user) and the raw AG-UI endpoint are not on the internet.

## Files

| File | Purpose |
| --- | --- |
| `deploy/web.Dockerfile` | Builds `web/` (context: repo root, so `seed/` is included), precompresses it, serves it with `server.mjs`. |
| `deploy/web/server.mjs` | Zero-dependency static host: SPA fallback, immutable caching for hashed assets, `/healthz`, optional basic auth, optional `/copilotkit` proxy to the agent. |
| `deploy/web/precompress.mjs` | Writes `.br` / `.gz` next to built assets (the main bundle goes from 2.6 MB to 0.55 MB). |
| `deploy/agent.Dockerfile` | Builds and runs `agent/ExpenseDesk/ExpenseDesk.csproj` (.NET 10) with `seed/` and `cards/`. |
| `deploy/railway-up.sh` | Uploads only what one service needs (`railway up` would otherwise send `design/`, `film/` and local `.env` files) and deploys it. |
| `deploy/smoke.sh` | Smoke test for a deployed URL. |
| `deploy/check_controls.py` | Part of the smoke test: controls are open on load and clicking them drives the demo. |
| `.dockerignore` | Keeps build output, dependencies and local secrets out of Docker contexts. |
| `web/.env.example` | The dashboard's build-time variables. |

Railway's `railway.json` / `railway.toml` (Config as Code) is deprecated: new services can't opt in and existing files stop being read on 2026-12-01. So each service is configured with a Dockerfile plus the CLI commands below. Railway's replacement, Infrastructure as Code (`.railway/railway.ts`), is an option later if you want the project in one file.

## Environment variables

> **`VITE_*` variables are inlined into the public JavaScript bundle at build time.** Anyone who opens the page can read them. Never put a secret in a `VITE_*` variable. Azure OpenAI / Foundry keys and the CopilotKit Intelligence API key go **only** on the `agent` service.

### `web` service

| Variable | Read at | Demo | Live | Notes |
| --- | --- | --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | build | `deploy/web.Dockerfile` | same | Tells Railway which Dockerfile to use. |
| `VITE_SHOW_DEMO_CONTROLS` | build, **public** | `true` | unset | Shows the presenter controls, open, on load. `?presenter` still works without it. |
| `VITE_COPILOTKIT_RUNTIME_URL` | build, **public** | unset | `/copilotkit` | Unset means the scripted agent. Relative path = same-origin proxy. |
| `VITE_COPILOTKIT_LICENSE_KEY` | build, **public** | unset | your public key | CopilotKit's *public* license key. Public by design. |
| `VITE_INTELLIGENCE_DASHBOARD_URL` | build, **public** | unset | optional | Adds "Open in CopilotKit Intelligence" to learned rules. |
| `BASIC_AUTH_USER` | runtime | recommended | recommended | Set both or neither (the server refuses to start with one). `/healthz` is never behind auth. |
| `BASIC_AUTH_PASSWORD` | runtime, secret | recommended | recommended | Set it with `--stdin` so it stays out of shell history. |
| `AGENT_UPSTREAM_URL` | runtime | unset | `http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:${{agent.PORT}}` | Turns on the `/copilotkit` proxy. Railway resolves the reference. |
| `RUNTIME_PROXY_PATH` | runtime | | default `/copilotkit` | Path that is proxied, unchanged, to the agent. |
| `PORT` | runtime | set by Railway | set by Railway | The server listens on it (default 8080). |

Build-time variables only change the site after a new build: run `deploy/railway-up.sh web` again.

### `agent` service (all model and Intelligence secrets live here)

Names come from `agent/ExpenseDesk/Hosting/DeskSettings.cs`.

| Variable | Secret | Required | Notes |
| --- | --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | | yes | `deploy/agent.Dockerfile` |
| `PORT` | | yes | Pin to `8080` so the web proxy's upstream URL is stable. |
| `AZURE_OPENAI_ENDPOINT` | | yes | `https://<resource>.openai.azure.com` or a Foundry `https://<resource>.services.ai.azure.com` endpoint. |
| `AZURE_OPENAI_DEPLOYMENT` | | yes | Model deployment name. |
| `AZURE_OPENAI_API_KEY` | **yes** | yes on Railway | Without it the agent uses `DefaultAzureCredential`. Railway has no managed identity, so then set a service principal instead: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (secret), with an inference role on the resource. |
| `CPK_INTELLIGENCE_API_KEY` | **yes** | yes | Without it `/copilotkit` is not mounted and the dashboard can't connect. |
| `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID` | | for learning | Automatic Learning / learned skills. |
| `CPK_INTELLIGENCE_SKILLS_REVISION` | | no | Pin a skills revision. |
| `INTELLIGENCE_API_URL`, `INTELLIGENCE_RUNNER_URL`, `INTELLIGENCE_CLIENT_URL` | | no | Only for a non-default Intelligence deployment. |
| `DESK_ALLOWED_ORIGINS` | | yes | The runtime's CORS / origin allow-list, comma-separated: the web service's public origin(s), e.g. `https://expense-desk-web.up.railway.app,https://expenses.example.com`. Needed with the proxy too, because the browser's `Origin` header is forwarded. |
| `DESK_DEMO_USER_ID`, `DESK_DEMO_USER_NAME` | | no | Who every request runs as (default Priya Raman). |
| `DESK_AGENT_URL` | | no | Set by the image to `http://127.0.0.1:$PORT/agents/expense` (the runtime calling its own agent). The code's default (port 5000) would be wrong in the container. |
| `DESK_SEED_DIR` | | no | Set by the image to `/app/seed`. |
| `ASPNETCORE_ENVIRONMENT` | | no | `Production` in the image. |

Seal the secret variables in the Railway dashboard (variable menu → Seal) so they can't be read back.

## Demo mode: deploy steps

Prerequisites: Railway CLI 5.45+ (`railway --version`), a Railway account on Hobby or Pro, Python Playwright for the smoke test (as for `design/capture_states.py`).

```bash
cd "/Users/jerel-cpk/Projects/Microsoft demo"
railway login                                     # once, opens a browser
railway init --name contoso-expense-desk          # creates the project, links this folder
railway add --service web

railway variable set --service web --skip-deploys \
  RAILWAY_DOCKERFILE_PATH=deploy/web.Dockerfile \
  VITE_SHOW_DEMO_CONTROLS=true \
  BASIC_AUTH_USER=contoso
read -rs BASIC_AUTH_PASSWORD; printf '%s' "$BASIC_AUTH_PASSWORD" \
  | railway variable set BASIC_AUTH_PASSWORD --stdin --service web --skip-deploys
railway environment edit --service-config web deploy.healthcheckPath /healthz
railway environment config --json | grep -i healthcheck   # confirm it took (or set it in Settings → Deploy)

deploy/railway-up.sh web                          # uploads ~0.6 MB, builds on Railway, streams logs
railway domain --service web                      # prints https://<name>.up.railway.app

BASIC_AUTH_USER=contoso BASIC_AUTH_PASSWORD="$BASIC_AUTH_PASSWORD" \
  deploy/smoke.sh https://<name>.up.railway.app
```

Share the URL plus the basic-auth user and password with testers (send the password separately).

**Railway MCP equivalent** (the MCP can't upload local code, so the deploy itself is still `deploy/railway-up.sh`): `create-project` → `create-service` (`name: web`) → `set-variables` (the variables above, `skipDeploys: true`) → `update-service` (`dockerfilePath: deploy/web.Dockerfile`, `healthcheckPath: /healthz`) → `railway link` + `deploy/railway-up.sh web` → `generate-domain`.

## Live mode: deploy steps

When `agent/ExpenseDesk` runs end to end locally. Keep `web` as the demo link and add a second web service for live mode, so testers' link keeps working while the backend settles.

```bash
railway add --service agent
railway variable set --service agent --skip-deploys \
  RAILWAY_DOCKERFILE_PATH=deploy/agent.Dockerfile \
  PORT=8080 \
  AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com \
  AZURE_OPENAI_DEPLOYMENT=<deployment> \
  CPK_INTELLIGENCE_LEARNING_CONTAINER_ID=<container id> \
  DESK_ALLOWED_ORIGINS=https://<web-live domain>
read -rs K; printf '%s' "$K" | railway variable set AZURE_OPENAI_API_KEY --stdin --service agent --skip-deploys
read -rs K; printf '%s' "$K" | railway variable set CPK_INTELLIGENCE_API_KEY --stdin --service agent --skip-deploys
railway environment edit --service-config agent deploy.healthcheckPath /healthz
deploy/railway-up.sh agent                        # no `railway domain` for agent: it stays private

railway add --service web-live
railway variable set --service web-live --skip-deploys \
  RAILWAY_DOCKERFILE_PATH=deploy/web.Dockerfile \
  VITE_COPILOTKIT_RUNTIME_URL=/copilotkit \
  VITE_COPILOTKIT_LICENSE_KEY=<public license key> \
  'AGENT_UPSTREAM_URL=http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:${{agent.PORT}}' \
  BASIC_AUTH_USER=contoso
read -rs BASIC_AUTH_PASSWORD; printf '%s' "$BASIC_AUTH_PASSWORD" \
  | railway variable set BASIC_AUTH_PASSWORD --stdin --service web-live --skip-deploys
railway environment edit --service-config web-live deploy.healthcheckPath /healthz
RAILWAY_SERVICE=web-live deploy/railway-up.sh web
railway domain --service web-live                 # then put this origin in the agent's DESK_ALLOWED_ORIGINS

SMOKE_MODE=live BASIC_AUTH_USER=contoso BASIC_AUTH_PASSWORD="$BASIC_AUTH_PASSWORD" \
  deploy/smoke.sh https://<web-live domain>
```

You only learn `web-live`'s domain after `railway domain`, so set `DESK_ALLOWED_ORIGINS` on `agent` afterwards (`railway variable set --service agent DESK_ALLOWED_ORIGINS=https://...`, which redeploys it). Or generate the domain first, before the first deploy.

Live smoke mode checks health, auth and static behaviour, then that `/copilotkit/info` reaches the runtime through the proxy (a 502 means the web host can't reach `agent`). The scripted walk-through doesn't apply to a live agent; walk the real flow by hand.

**Without the proxy** (e.g. the web app on Vercel): give `agent` a public domain, build the dashboard with `VITE_COPILOTKIT_RUNTIME_URL=https://<agent domain>/copilotkit`, and put the dashboard's origin in `DESK_ALLOWED_ORIGINS`. The runtime is then public and not covered by basic auth.

## Health checks

| Service | Path | Notes |
| --- | --- | --- |
| `web` | `/healthz` | 200 `{"ok":true}`, never behind basic auth, `no-store`. |
| `agent` | `/healthz` | 200 `{"status":"ok","runtime":…,"model":…,"learnedSkills":…}`; the three flags say whether the CopilotKit runtime, the model and learned skills are configured. `GET /` also returns 200. |

Railway only calls the health check while a deploy goes live (default timeout 300 s), not continuously.

## Caching

`/assets/*` (Vite's content-hashed files) are `max-age=31536000, immutable`; `index.html` is `no-cache`; other files 1 hour. Text assets are served as Brotli or gzip when the browser accepts them. With basic auth on, every cacheable response is `private`, so leave Railway's CDN off for the protected services, otherwise a shared cache could serve pages without the password.

## Custom domain

`railway domain expenses.example.com --service web` prints the DNS record (CNAME) to add. Railway issues the TLS certificate once DNS resolves. For live mode, add the new origin to the agent's `DESK_ALLOWED_ORIGINS`.

## Cost

Railway bills a plan fee plus usage: Hobby is $5/month including $5 of usage; usage is $10 per GB of RAM per month, $20 per vCPU per month and $0.05 per GB of egress, and builds are free. The web server idles at about 40 MB of RAM, so demo mode should fit inside Hobby's included usage. The .NET agent adds a few dollars a month at idle (roughly 150–250 MB). Model tokens are billed by Azure, not Railway. To cut idle cost, turn on serverless (app sleeping) for `web` in the service settings; the first visit after a quiet period then waits a few seconds for it to wake.

## Smoke test

```bash
deploy/smoke.sh <base_url> [screenshot_dir]
```

Checks `/healthz`, basic auth (when `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` are set), immutable asset caching, SPA fallback and 404s, then runs `design/capture_states.py` against the URL and fails on any console error, then checks the presenter controls are open on load and drive the demo by clicking. `EXPECT_DEMO_CONTROLS=0` skips that last check; `SMOKE_MODE=live` is described above; `HEALTH_PATH=/` suits hosts without `/healthz`.

## Run it locally

Without Docker (what the smoke test was verified against):

```bash
npm --prefix web ci
VITE_SHOW_DEMO_CONTROLS=true npm --prefix web run build
node deploy/web/precompress.mjs web/dist
STATIC_DIR=web/dist PORT=4630 node deploy/web/server.mjs     # add BASIC_AUTH_USER/BASIC_AUTH_PASSWORD to try auth
deploy/smoke.sh http://localhost:4630
```

With Docker, from the repo root:

```bash
docker build -f deploy/web.Dockerfile --build-arg VITE_SHOW_DEMO_CONTROLS=true -t expense-desk-web .
docker run --rm -p 4630:8080 expense-desk-web
docker build -f deploy/agent.Dockerfile -t expense-desk-agent .
docker run --rm -p 4640:8080 --env-file agent.env expense-desk-agent   # agent.env: the agent variables above
```

## Alternative: Vercel (static site only)

Vercel can host demo mode, not the .NET agent. Import the project with Root Directory `web`, framework Vite, and keep "Include files outside the root directory in the Build Step" on (the build imports `../seed`). Set `VITE_SHOW_DEMO_CONTROLS=true`. Differences from Railway: there is no `/healthz` (smoke test with `HEALTH_PATH=/`), and no basic auth; use Vercel's Deployment Protection instead (password protection is a paid add-on; Vercel Authentication needs testers to have Vercel accounts). For live mode from Vercel, see "Without the proxy" above. The Vercel plugin in this environment isn't authenticated, so nothing was checked against a live Vercel project.
