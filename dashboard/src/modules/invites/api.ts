export interface InvitePreview {
  workspace_name: string;
  invited_by_email: string;
  email: string;
  expires_at: string;
}

export class InviteError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'InviteError';
    this.status = status;
    this.code = code;
  }
}

function base(): string {
  return import.meta.env.VITE_API_URL || window.location.origin;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base()}${path}`, init);
  if (!response.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch {
      // ignore parse errors
    }
    throw new InviteError(message, response.status, code);
  }
  return response.json() as Promise<T>;
}

export function previewInvite(token: string): Promise<InvitePreview> {
  return request<InvitePreview>(`/v1/invites/${encodeURIComponent(token)}`);
}

export function acceptInvite(token: string, sessionToken: string): Promise<{ workspace_id: string }> {
  return request(`/v1/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}
