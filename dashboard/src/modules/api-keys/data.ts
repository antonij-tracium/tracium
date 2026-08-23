import type { ApiKey } from './interfaces';
import type { ApiKeyId } from './ids';

export const API_KEYS: ApiKey[] = [
  {
    id: "k_8af2" as ApiKeyId, name: "Production · Web app",       prefix: "tr_live", tail: "K2nQ",
    env: "production",  scopes: ["traces:write", "metrics:read"],
    createdBy: "Mark Gonzales", createdAt: "Mar 12, 2026",
    lastUsedAt: "2 minutes ago", lastUsedIp: "44.221.87.12",
    requests7d: 184022, spark: [4.2, 4.4, 4.1, 4.6, 5.0, 4.9, 5.4], status: "active",
  },
  {
    id: "k_4c91" as ApiKeyId, name: "Production · Worker pool",   prefix: "tr_live", tail: "x9pH",
    env: "production",  scopes: ["traces:write"],
    createdBy: "Sara Liu", createdAt: "Feb 4, 2026",
    lastUsedAt: "12 seconds ago", lastUsedIp: "44.221.87.4",
    requests7d: 421882, spark: [9.2, 8.8, 9.4, 10.1, 11.2, 11.8, 12.4], status: "active",
  },
  {
    id: "k_d712" as ApiKeyId, name: "Staging · CI runner",        prefix: "tr_test", tail: "vR3m",
    env: "staging",     scopes: ["traces:write", "metrics:read", "agents:write"],
    createdBy: "Dev pipeline", createdAt: "Apr 2, 2026",
    lastUsedAt: "8 minutes ago", lastUsedIp: "10.4.0.18",
    requests7d: 12204, spark: [0.4, 0.5, 0.4, 0.5, 0.6, 0.5, 0.6], status: "active",
  },
  {
    id: "k_1e08" as ApiKeyId, name: "Local · Mark's laptop",      prefix: "tr_test", tail: "JqYf",
    env: "development", scopes: ["traces:write", "metrics:read"],
    createdBy: "Mark Gonzales", createdAt: "Jan 22, 2026",
    lastUsedAt: "3 days ago", lastUsedIp: "127.0.0.1",
    requests7d: 482, spark: [0.05, 0.04, 0.07, 0.04, 0.06, 0.0, 0.0], status: "stale",
  },
  {
    id: "k_a201" as ApiKeyId, name: "Read-only · Grafana sync",   prefix: "tr_live", tail: "Ld7G",
    env: "production",  scopes: ["traces:read", "metrics:read"],
    createdBy: "Sara Liu", createdAt: "Feb 18, 2026",
    lastUsedAt: "41 minutes ago", lastUsedIp: "52.4.18.99",
    requests7d: 8412, spark: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], status: "active",
  },
  {
    id: "k_77f4" as ApiKeyId, name: "Old · Rotated 2026-03",      prefix: "tr_live", tail: "0bWp",
    env: "production",  scopes: ["traces:write"],
    createdBy: "Mark Gonzales", createdAt: "Nov 4, 2025",
    revokedAt: "Mar 12, 2026", revokedBy: "Mark Gonzales", revokedReason: "Routine rotation",
    lastUsedAt: "Mar 11, 2026", lastUsedIp: null,
    requests7d: 0, spark: [0, 0, 0, 0, 0, 0, 0], status: "revoked",
  },
];
