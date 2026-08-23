import type { ApiKeyId } from '../ids';

export interface ApiKey {
  id: ApiKeyId;
  name: string;
  prefix: string;
  tail: string;
  env: 'production' | 'staging' | 'development';
  scopes: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string;
  lastUsedIp: string | null;
  requests7d: number;
  spark: number[];
  status: 'active' | 'stale' | 'revoked';
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  fullSecret?: string;
}
