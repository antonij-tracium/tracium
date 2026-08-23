// Supplemental, configuration-level metadata for an agent, shown on the agent
// detail page. This is the agent's *configuration* — model, runtime params,
// and the tools it can call — not health or anomaly state, both of which are
// intentionally absent from the OSS dashboard.

export interface AgentTool {
  name: string;
  /** Whether this tool is wired into the agent's current deployment. */
  used: boolean;
  description: string;
}

export interface AgentMeta {
  description: string;
  model: string;
  provider: string;
  version: string;
  owner: string;
  team: string;
  created: string;
  lastDeploy: string;
  temperature: number;
  maxTokens: number;
  timeout: string;
  retries: number;
  endpoint: string;
  tools: AgentTool[];
}
