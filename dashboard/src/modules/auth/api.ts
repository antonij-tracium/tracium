export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

/**
 * Outcome of a registration. The hosted service withholds the session token
 * until the account confirms its email (confirmationRequired), so token is null
 * in that case. The standalone application issues a token immediately.
 */
export interface RegisterResult {
  token: string | null;
  confirmationRequired: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Calls an endpoint that needs no session, throwing AuthError on failure. */
export async function publicRequest(path: string, init: RequestInit, failureLabel: string): Promise<Response> {
  const base = import.meta.env.VITE_API_URL || window.location.origin;
  const response = await fetch(`${base}${path}`, init);

  if (!response.ok) {
    let message = `${failureLabel} (${response.status})`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore parse errors
    }
    throw new AuthError(message, response.status);
  }

  return response;
}

function postCredentials(path: string, req: LoginRequest, failureLabel: string): Promise<Response> {
  return publicRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  }, failureLabel);
}

export async function loginUser(req: LoginRequest): Promise<LoginResponse> {
  const response = await postCredentials('/v1/auth/login', req, 'Login failed');
  return response.json() as Promise<LoginResponse>;
}

export async function registerUser(req: LoginRequest): Promise<RegisterResult> {
  const response = await postCredentials('/v1/auth/register', req, 'Sign up failed');
  // 202 Accepted: the account was created but must confirm its email before it
  // can sign in, so no token is issued. 201 Created: a token was returned.
  if (response.status === 202) {
    return { token: null, confirmationRequired: true };
  }
  const body = await response.json() as LoginResponse;
  return { token: body.token, confirmationRequired: false };
}
