export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function postCredentials(path: string, req: LoginRequest, failureLabel: string): Promise<LoginResponse> {
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8090';
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

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

  return response.json() as Promise<LoginResponse>;
}

export function loginUser(req: LoginRequest): Promise<LoginResponse> {
  return postCredentials('/v1/auth/login', req, 'Login failed');
}

export function registerUser(req: LoginRequest): Promise<LoginResponse> {
  return postCredentials('/v1/auth/register', req, 'Sign up failed');
}
