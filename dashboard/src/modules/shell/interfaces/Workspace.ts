import type { WorkspaceId } from '../ids';

export interface Workspace {
  id: WorkspaceId;
  name: string;
  slug: string;
  role: string;
  members: number;
  env: 'production' | 'development' | 'staging';
}
