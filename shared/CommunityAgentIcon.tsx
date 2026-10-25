import { Sparkles } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { CommunityAvatar } from "./CommunityAvatar";
import { useCommunityVisualIdentity } from "./CommunityVisualIdentityRegistry";

// The community agent wears its community's icon (Rashid, 2026-10-25): chat
// messages, the Ask AI button, the agent panel and mentions. With no icon it
// keeps the Sparkles.
const AgentCommunityContext = createContext<string | null>(null);

export function AgentCommunityProvider(props: { communityId: string | null; children: ReactNode }) {
  return <AgentCommunityContext.Provider value={props.communityId}>{props.children}</AgentCommunityContext.Provider>;
}

export function CommunityAgentIcon(props: { size?: number; strokeWidth?: number; communityId?: string | null }) {
  const contextId = useContext(AgentCommunityContext);
  const communityId = props.communityId ?? contextId;
  const identity = useCommunityVisualIdentity(communityId);
  if (!communityId || !identity?.avatar.url) {
    return <Sparkles size={props.size} strokeWidth={props.strokeWidth} aria-hidden="true" />;
  }
  return <CommunityAvatar communityId={communityId} name={identity.name} className="community-agent-face"
    style={props.size ? { width: props.size, height: props.size } : undefined} alt="" aria-hidden={true} />;
}
