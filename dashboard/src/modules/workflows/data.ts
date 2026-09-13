import type { Workflow, WorkflowMeta } from './interfaces';

// Demo workflows for the logged-out auth-page preview (embedded mode). The live app
// fetches the same shape from GET /v1/metrics/workflows. avg_latency_ms is in
// milliseconds; error_rate is a fraction (0–1). last_trace_id points at the demo
// trace so a row click resolves in the embedded preview.
const DEMO_TRACE = "t_a9f2_eb7c";

export const WORKFLOWS: Workflow[] = [
  { name: "summarize-comments",              calls: 847,  cost: 0.4234, avg_latency_ms: 2100, error_rate: 0.002, trend: [12,14,18,16,22,28,34,31,29,38,42,39,44],    last_trace_id: DEMO_TRACE },
  { name: "generate-clock-out-description",  calls: 412,  cost: 0.2891, avg_latency_ms: 3400, error_rate: 0.0,   trend: [8,10,9,12,14,16,15,18,20,19,22,24,21],       last_trace_id: DEMO_TRACE },
  { name: "classify-intent",                 calls: 1203, cost: 0.1204, avg_latency_ms: 800,  error_rate: 0.014, trend: [42,48,52,49,55,61,58,63,72,68,74,81,88],      last_trace_id: DEMO_TRACE },
  { name: "extract-entities",                calls: 328,  cost: 0.0892, avg_latency_ms: 1200, error_rate: 0.0,   trend: [4,5,6,5,7,8,7,9,10,9,11,12,10],              last_trace_id: DEMO_TRACE },
  { name: "rewrite-message",                 calls: 156,  cost: 0.3104, avg_latency_ms: 4800, error_rate: 0.083, trend: [2,3,4,3,5,6,5,8,12,14,18,22,28],             last_trace_id: DEMO_TRACE },
  { name: "detect-sentiment",                calls: 612,  cost: 0.0412, avg_latency_ms: 600,  error_rate: 0.003, trend: [18,20,22,19,24,26,28,25,30,32,34,31,35],      last_trace_id: DEMO_TRACE },
  { name: "summarize-thread",                calls: 89,   cost: 0.0834, avg_latency_ms: 3100, error_rate: 0.011, trend: [1,2,3,2,4,5,4,6,7,8,9,11,12],                last_trace_id: DEMO_TRACE },
  { name: "moderate-content",                calls: 2104, cost: 0.0892, avg_latency_ms: 400,  error_rate: 0.001, trend: [80,85,92,88,96,102,108,112,118,124,128,132,138], last_trace_id: DEMO_TRACE },
];

// Per-workflow configuration metadata for the detail page, keyed by workflow name.
// Demo-only: there is no live per-workflow config endpoint yet, so the detail page
// renders this for every workflow (falling back to a representative entry for any
// live workflow not listed here). Health and anomaly fields are deliberately
// absent — only configuration and the workflow's tool surface live here.
export const WORKFLOW_META: Record<string, WorkflowMeta> = {
  "summarize-comments": {
    description: "Condenses long comment threads into a 3–5 bullet digest with sentiment and unresolved-question flags. Runs on every thread close.",
    model: "claude-sonnet-4-5", provider: "anthropic", version: "v3.1.0",
    owner: "Mark Gonzales", team: "Insights", created: "Nov 8, 2025", lastDeploy: "5 days ago",
    temperature: 0.2, maxTokens: 1024, timeout: "45s", retries: 1, endpoint: "workflows.summarize-comments",
    tools: [
      { name: "thread.fetch",    used: true,  description: "Loads the full comment thread with author and timestamp metadata." },
      { name: "sentiment.score", used: true,  description: "Returns per-comment sentiment for the digest header." },
      { name: "pii.redact",      used: true,  description: "Strips emails and phone numbers before summarisation." },
      { name: "glossary.lookup", used: false, description: "Expands workspace-specific acronyms found in the thread." },
    ],
  },
  "generate-clock-out-description": {
    description: "Drafts an end-of-shift summary from a worker's activity log, matching the org's reporting template and tone.",
    model: "claude-sonnet-4-5", provider: "anthropic", version: "v1.6.2",
    owner: "Sara Liu", team: "Workforce", created: "Dec 14, 2025", lastDeploy: "11 days ago",
    temperature: 0.4, maxTokens: 768, timeout: "30s", retries: 2, endpoint: "workflows.generate-clock-out-description",
    tools: [
      { name: "shift.activity", used: true,  description: "Pulls the structured activity log for the shift window." },
      { name: "template.fetch", used: true,  description: "Retrieves the org's clock-out report template." },
      { name: "users.lookup",   used: false, description: "Resolves a worker ID to a profile for personalisation." },
    ],
  },
  "classify-intent": {
    description: "Routes inbound messages into one of 18 intent labels with a confidence score. Powers downstream automation triggers.",
    model: "claude-haiku-4-5", provider: "anthropic", version: "v4.2.0",
    owner: "Mark Gonzales", team: "Routing", created: "Oct 2, 2025", lastDeploy: "yesterday",
    temperature: 0.0, maxTokens: 128, timeout: "15s", retries: 2, endpoint: "workflows.classify-intent",
    tools: [
      { name: "intent.taxonomy",      used: true,  description: "Loads the active 18-label intent taxonomy for the workspace." },
      { name: "history.recall",       used: true,  description: "Fetches the last 3 messages for conversational context." },
      { name: "confidence.calibrate", used: false, description: "Applies temperature-scaled calibration to raw logits." },
      { name: "fallback.route",       used: false, description: "Routes low-confidence cases to a human review queue." },
    ],
  },
  "extract-entities": {
    description: "Pulls structured entities (people, orgs, dates, amounts) from free text and returns them as typed spans with offsets.",
    model: "claude-haiku-4-5", provider: "anthropic", version: "v2.0.4",
    owner: "Sara Liu", team: "Insights", created: "Jan 5, 2026", lastDeploy: "8 days ago",
    temperature: 0.0, maxTokens: 512, timeout: "20s", retries: 1, endpoint: "workflows.extract-entities",
    tools: [
      { name: "ner.schema",     used: true,  description: "Loads the entity-type schema and validation rules." },
      { name: "date.normalize", used: true,  description: "Resolves relative dates against the message timestamp." },
      { name: "currency.parse", used: false, description: "Normalises amounts and currency symbols to ISO codes." },
    ],
  },
  "rewrite-message": {
    description: "Rewrites a user-supplied draft to match a target tone and audience, enforcing word-count and style-guide constraints before returning.",
    model: "claude-haiku-4-5", provider: "anthropic", version: "v2.4.1",
    owner: "Sara Liu", team: "Messaging", created: "Jan 22, 2026", lastDeploy: "2 days ago",
    temperature: 0.3, maxTokens: 512, timeout: "30s", retries: 2, endpoint: "workflows.rewrite-message",
    tools: [
      { name: "tone.classify",     used: true,  description: "Returns a softmax over five tone labels (formal, casual, urgent, frustrated, neutral)." },
      { name: "style_guide.fetch", used: false, description: "Retrieves the workspace's writing style guide entries by audience tag." },
      { name: "draft.refine",      used: false, description: "One-shot LLM refinement pass on a candidate draft against a target tone." },
      { name: "users.lookup",      used: false, description: "Resolves a Slack user ID to a profile for personalisation." },
      { name: "rate_limit.check",  used: false, description: "Returns the user's remaining rewrite quota and reset time." },
    ],
  },
  "detect-sentiment": {
    description: "Scores a single message on a continuous -1 to +1 sentiment axis with an emotion label. Lowest-latency workflow in the workspace.",
    model: "claude-haiku-4-5", provider: "anthropic", version: "v3.0.1",
    owner: "Mark Gonzales", team: "Insights", created: "Sep 19, 2025", lastDeploy: "3 weeks ago",
    temperature: 0.0, maxTokens: 64, timeout: "10s", retries: 1, endpoint: "workflows.detect-sentiment",
    tools: [
      { name: "emotion.labels", used: true,  description: "Loads the emotion-label set mapped to the sentiment axis." },
      { name: "emoji.decode",   used: false, description: "Translates emoji into sentiment-bearing tokens." },
    ],
  },
  "summarize-thread": {
    description: "Produces a narrative summary of an entire conversation thread, preserving decisions and action items in order.",
    model: "claude-sonnet-4-5", provider: "anthropic", version: "v1.3.0",
    owner: "Sara Liu", team: "Insights", created: "Feb 1, 2026", lastDeploy: "6 days ago",
    temperature: 0.3, maxTokens: 1536, timeout: "60s", retries: 1, endpoint: "workflows.summarize-thread",
    tools: [
      { name: "thread.fetch",       used: true,  description: "Loads the full thread with branch structure." },
      { name: "actionitem.extract", used: true,  description: "Identifies and orders action items and owners." },
      { name: "glossary.lookup",    used: false, description: "Expands workspace-specific acronyms found in the thread." },
    ],
  },
  "moderate-content": {
    description: "Flags policy-violating content across 9 categories and returns a block/allow/review decision. Highest-volume workflow.",
    model: "claude-haiku-4-5", provider: "anthropic", version: "v5.1.2",
    owner: "Mark Gonzales", team: "Trust & Safety", created: "Aug 4, 2025", lastDeploy: "4 days ago",
    temperature: 0.0, maxTokens: 96, timeout: "10s", retries: 2, endpoint: "workflows.moderate-content",
    tools: [
      { name: "policy.matrix",  used: true,  description: "Loads the 9-category moderation policy matrix." },
      { name: "image.classify", used: false, description: "Routes attached images to the vision moderation model." },
      { name: "appeal.log",     used: false, description: "Records borderline decisions for the appeals pipeline." },
    ],
  },
};

// Representative fallback for any workflow without a dedicated WORKFLOW_META entry
// (e.g. a live workflow name not in the demo set).
export const DEFAULT_WORKFLOW_META = WORKFLOW_META["rewrite-message"];
