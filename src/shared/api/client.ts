import { z } from 'zod';

import type { ResponseAdapter } from './responseAdapter';

const csrfResponseSchema = z.object({ data: z.object({ token: z.string().min(1) }) });
let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let csrfRequestId = 0;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API request failed with status ${status}.`);
    this.name = 'ApiError';
  }
}

type ApiRequestOptions<T> = RequestInit & {
  responseAdapter: ResponseAdapter<T>;
};

function createCsrfRequest() {
  const requestId = ++csrfRequestId;
  const request = (async () => {
    const response = await fetch('/api/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body);
    const token = csrfResponseSchema.parse(body).data.token;
    if (csrfRequestId === requestId) csrfToken = token;
    return token;
  })().finally(() => {
    if (csrfRequestId === requestId) csrfRequest = null;
  });
  csrfRequest = request;
  return request;
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  return csrfRequest ?? createCsrfRequest();
}

export function refreshCsrfToken() {
  csrfToken = null;
  csrfRequest = null;
  return createCsrfRequest();
}

export function clearCsrfToken() {
  csrfRequestId += 1;
  csrfToken = null;
  csrfRequest = null;
}

function isCsrfFailure(body: unknown) {
  if (!body || typeof body !== 'object' || !('error' in body)) return false;
  const error = body.error;
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'CSRF_INVALID',
  );
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions<T>): Promise<T> {
  const { responseAdapter, ...init } = options;
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
    !path.startsWith('/__mock/') &&
    !headers.has('X-CSRF-Token')
  ) {
    headers.set('X-CSRF-Token', await getCsrfToken());
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 403 && isCsrfFailure(body)) clearCsrfToken();
    throw new ApiError(response.status, body);
  }

  return responseAdapter.fromResponse(body);
}
