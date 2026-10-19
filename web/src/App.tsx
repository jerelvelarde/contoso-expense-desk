import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { AGENT_ID } from "./agent/contract";
import { localAgents } from "./agent/local";
import { DemoControls } from "./components/DemoControls";
import { EmptyDetail, RequestDetail } from "./components/RequestDetail";
import { RequestQueue } from "./components/RequestQueue";
import { TopBar } from "./components/TopBar";
import { toolRenderers } from "./components/toolRenderers";
import { DeskProvider, useDesk } from "./desk/DeskProvider";

/**
 * With VITE_COPILOTKIT_RUNTIME_URL set, the dashboard talks to the CopilotKit
 * .NET runtime (Microsoft Agent Framework agent, Intelligence-connected).
 * Without it, a scripted AG-UI agent plays the demo locally.
 */
const runtimeUrl = import.meta.env.VITE_COPILOTKIT_RUNTIME_URL as string | undefined;
const licenseKey = import.meta.env.VITE_COPILOTKIT_LICENSE_KEY as string | undefined;
const mode = runtimeUrl ? "runtime" : "demo";

export default function App() {
  return (
    <CopilotKitProvider
      runtimeUrl={runtimeUrl}
      publicLicenseKey={licenseKey}
      agents__unsafe_dev_only={runtimeUrl ? undefined : localAgents}
      agentId={AGENT_ID}
      renderToolCalls={toolRenderers}
      enableInspector={false}
      showIntelligenceIndicator={false}
    >
      <DeskProvider>
        <Desk />
      </DeskProvider>
    </CopilotKitProvider>
  );
}

function Desk() {
  const { selected, desk } = useDesk();
  return (
    <div className="grid h-dvh grid-rows-[56px_minmax(0,1fr)]">
      <TopBar mode={mode} />
      <div className="grid min-h-0 grid-cols-[360px_minmax(0,1fr)] max-[1360px]:grid-cols-[320px_minmax(0,1fr)] max-[900px]:grid-cols-1">
        <RequestQueue />
        <main className="mr-2 mb-2 min-h-0 overflow-y-auto rounded-xl bg-surface shadow-sheet max-[900px]:ml-2">
          {selected ? <RequestDetail request={selected} /> : <EmptyDetail connected={mode === "demo" || desk.requests.length > 0} />}
        </main>
      </div>
      {/* Stands in for Teams in both modes until the Teams channel is wired. */}
      <DemoControls />
    </div>
  );
}
