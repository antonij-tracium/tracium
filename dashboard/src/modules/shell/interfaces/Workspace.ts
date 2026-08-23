import type { WorkspaceId } from '../ids';

export interface Workspace {
  id: WorkspaceId;
  name: string;
  slug: string;
  role: string;
  members: number;
  plan: string;
  env: 'production' | 'development' | 'staging';
}
