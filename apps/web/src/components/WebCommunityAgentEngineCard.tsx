import { useEffect, useState } from "react";
import {
  getCloudCommunityInferenceEngine,
  type CloudCommunityInferenceEngine,
} from "../../../../shared/cloudCommunityAgentGateway";
import "./WebCommunityAgentEngineCard.css";

// Settings → Agent: which AI engine answers for the community agent. The engine
// is chosen by whoever runs this Polynet, so the card only reports it.
export function WebCommunityAgentEngineCard() {
  const [engine, setEngine] = useState<CloudCommunityInferenceEngine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getCloudCommunityInferenceEngine()
      .then((value) => { if (alive) setEngine(value); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  if (failed || !engine) return null;
  return <section className="agent-engine-card" aria-label="AI engine" data-ready={engine.ready ? "yes" : "no"}>
    <div className="agent-engine-card-head">
      <span className="agent-engine-card-label">AI engine</span>
      {engine.testOnly ? <span className="agent-engine-card-tag">Local test</span> : null}
    </div>
    <p className="agent-engine-card-name">{engine.label}{engine.model ? <span> · {engine.model}</span> : null}</p>
    {engine.problem
      ? <p className="agent-engine-card-problem" role="status">Not ready: {engine.problem}</p>
      : <p className="agent-engine-card-note">{engine.testOnly
        ? "Your agent answers with the Claude Code login on this computer. Use it to test; live communities run on the platform's engine."
        : "Your agent's replies, workflow messages and reviews run here."}</p>}
  </section>;
}
