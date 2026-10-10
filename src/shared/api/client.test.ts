import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiDataResponseAdapter } from './responseAdapter';
import { apiRequest, clearCsrfToken, refreshCsrfToken } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('apiRequest CSRF handling', () => {
  it('fetches a token before a state-changing request and sends it in the header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'csrf-1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/me', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: '새 닉네임' }),
      responseAdapter: apiDataResponseAdapter(z.null()),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/csrf',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('X-CSRF-Token')).toBe('csrf-1');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/me');
  });

  it('shares a pending token request across concurrent writes', async () => {
    let finishCsrf!: (response: Response) => void;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url === '/api/csrf') {
        return new Promise<Response>((resolve) => {
          finishCsrf = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ data: null })));
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = apiRequest('/me/first', {
      method: 'POST',
      responseAdapter: apiDataResponseAdapter(z.null()),
    });
    const second = apiRequest('/me/second', {
      method: 'POST',
      responseAdapter: apiDataResponseAdapter(z.null()),
    });
    await vi.waitFor(() => expect(finishCsrf).toBeTypeOf('function'));
    finishCsrf(new Response(JSON.stringify({ data: { token: 'shared-token' } })));

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/csrf')).toHaveLength(1);
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url !== '/api/csrf')
        .map(([, init]) => new Headers((init as RequestInit).headers).get('X-CSRF-Token')),
    ).toEqual(['shared-token', 'shared-token']);
  });

  it('refreshes the cached token after authentication changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'before-login' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'after-login' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/first', {
      method: 'POST',
      responseAdapter: apiDataResponseAdapter(z.null()),
    });
    await refreshCsrfToken();
    await apiRequest('/second', {
      method: 'POST',
      responseAdapter: apiDataResponseAdapter(z.null()),
    });

    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBe('before-login');
    expect(
      new Headers((fetchMock.mock.calls[3]?.[1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBe('after-login');
  });

  it('blocks a state-changing request while CSRF is unavailable and retries token lookup next time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'retry-token' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/me', { method: 'PATCH', responseAdapter: apiDataResponseAdapter(z.null()) }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/csrf', expect.anything());

    await expect(
      apiRequest('/me', { method: 'PATCH', responseAdapter: apiDataResponseAdapter(z.null()) }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/me');
    expect(
      new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBe('retry-token');
  });
});
