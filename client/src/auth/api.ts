const BASE = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed');
  return data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { credentials: 'include' }).then(handle<T>);
}
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(handle<T>);
}
export function apiDelete<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', credentials: 'include' }).then(handle<T>);
}
