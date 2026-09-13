import { BaseAPIClient } from './client';

/**
 * ApiKeyRecord is the non-secret metadata the API lists back for a key — the
 * secret token itself is never returned here, only its `prefix`. Mirrors the
 * `APIKey` schema in spec/api/openapi.yaml. `last_used_at` / `revoked_at` are
 * null until the key is first used / revoked.
 */
export interface ApiKeyRecord {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * CreatedApiKey is the response to a create call: the key's metadata plus the
 * one-time plaintext `token`. The token is present only here and cannot be
 * retrieved again — the UI must surface it immediately.
 */
export interface CreatedApiKey {
  key: ApiKeyRecord;
  token: string;
}

/**
 * ApiKeysAPI wraps the per-workspace ingest-key endpoints. Every route nests
 * under a workspace id in the path (membership-gated server-side), so each
 * method takes the workspace id explicitly rather than relying on the client's
 * ambient workspace scoping.
 */
export class ApiKeysAPI extends BaseAPIClient {
  list(workspaceId: string): Promise<ApiKeyRecord[]> {
    return this.get<ApiKeyRecord[]>(`/workspaces/${workspaceId}/api-keys`);
  }

  create(workspaceId: string, name: string): Promise<CreatedApiKey> {
    return this.post<CreatedApiKey>(`/workspaces/${workspaceId}/api-keys`, { name });
  }

  revoke(workspaceId: string, keyId: string): Promise<void> {
    return this.delete(`/workspaces/${workspaceId}/api-keys/${keyId}`);
  }
}
