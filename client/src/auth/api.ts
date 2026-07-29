// Dev: the server is on :3001. Prod: same origin (relative URLs) — the server
// serves this bundle, so REST calls hit the same host on any domain / tunnel.
const BASE = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

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
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(handle<T>);
}
export function apiDelete<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', credentials: 'include' }).then(handle<T>);
}
/** Upload a raw file body (used by the music library). Uses XHR because fetch
    cannot report upload progress; onProgress gets 0–100 as bytes go out. */
export class UploadAbortedError extends Error {
  constructor() { super('Upload cancelled'); this.name = 'UploadAbortedError'; }
}

export function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (signal) {
      if (signal.aborted) { reject(new UploadAbortedError()); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.onabort = () => reject(new UploadAbortedError());
    xhr.open('POST', `${BASE}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, (data as { error?: string }).error ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(file);
  });
}
/** Streaming URL for an uploaded track (same origin in prod). */
export function audioUrl(trackId: string): string {
  return `${BASE}/api/library/${trackId}/audio`;
}
