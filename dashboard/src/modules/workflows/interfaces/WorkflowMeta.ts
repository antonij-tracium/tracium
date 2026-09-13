// Supplemental, configuration-level metadata for an workflow, shown on the workflow
// detail page. This is the workflow's *configuration* — model, runtime params,
// and the tools it can call — not health or anomaly state, both of which are
// intentionally absent from the OSS dashboard.

export interface WorkflowTool {
  name: string;
  /** Whether this tool is wired into the workflow's current deployment. */
  used: boolean;
  description: string;
}

export interface WorkflowMeta {
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
  tools: WorkflowTool[];
}
