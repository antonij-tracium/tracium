import { BaseAPIClient } from './client';
import type { Workspace } from '../../modules/shell/interfaces';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  env: Workspace['env'];
}

export class WorkspacesAPI extends BaseAPIClient {
  list(): Promise<Workspace[]> {
    return this.get<Workspace[]>('/workspaces');
  }

  create(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.post<Workspace>('/workspaces', input);
  }

  remove(id: string): Promise<void> {
    return this.delete(`/workspaces/${id}`);
  }
}
