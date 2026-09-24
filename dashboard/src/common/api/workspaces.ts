import { BaseAPIClient } from './client';
import type { Workspace } from '../../modules/shell/interfaces';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  env: Workspace['env'];
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: 'member';
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export interface CreatedInvite extends WorkspaceInvite {
  token: string;
}

export function inviteLink(token: string, origin = window.location.origin): string {
  return `${origin}/invite/${encodeURIComponent(token)}`;
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

  members(id: string): Promise<WorkspaceMember[]> {
    return this.get<WorkspaceMember[]>(`/workspaces/${id}/members`);
  }

  removeMember(id: string, userId: string): Promise<void> {
    return this.delete(`/workspaces/${id}/members/${encodeURIComponent(userId)}`);
  }

  invites(id: string): Promise<WorkspaceInvite[]> {
    return this.get<WorkspaceInvite[]>(`/workspaces/${id}/invites`);
  }

  invite(id: string, email: string): Promise<CreatedInvite> {
    return this.post<CreatedInvite>(`/workspaces/${id}/invites`, { email });
  }

  revokeInvite(id: string, inviteId: string): Promise<void> {
    return this.delete(`/workspaces/${id}/invites/${inviteId}`);
  }
}
