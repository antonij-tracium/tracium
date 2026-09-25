import { publicRequest } from '../auth/api';

export interface InvitePreview {
  workspace_name: string;
  invited_by_email: string;
  email: string;
  expires_at: string;
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const response = await publicRequest(`/v1/invites/${encodeURIComponent(token)}`, {}, 'Could not load invite');
  return response.json() as Promise<InvitePreview>;
}
