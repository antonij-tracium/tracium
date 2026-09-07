export interface APIClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /**
   * The active workspace the dashboard is scoped to. When set, GET requests
   * append it as the `workspace_id` query param so the API scopes reads to that
   * workspace. Cleared (undefined) means unscoped — every workspace's data.
   */
  workspaceId?: string;
}
