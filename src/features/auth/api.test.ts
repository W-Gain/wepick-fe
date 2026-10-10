import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCsrfToken } from '../../shared/api/client';
import {
  currentMemberResponseAdapter,
  getCurrentMember,
  refreshCsrfToken,
  resolveCurrentSessionStatus,
} from './api';

const member = { id: 7, nickname: '말랑구름', profileImageUrl: null };

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('current member adapter', () => {
  it('extracts the accepted Me DTO from its response envelope', () => {
    expect(currentMemberResponseAdapter.fromResponse({ data: member })).toEqual(member);
  });
});

describe('resolveCurrentSessionStatus', () => {
  it('returns authenticated when GET /api/me confirms the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: member })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveCurrentSessionStatus()).resolves.toBe('authenticated');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('returns anonymous only for an unauthenticated session response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
        ),
    );

    await expect(resolveCurrentSessionStatus()).resolves.toBe('anonymous');
  });

  it('keeps authorization or server failures unavailable instead of treating them as anonymous', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
        ),
    );

    await expect(resolveCurrentSessionStatus()).rejects.toMatchObject({ status: 403 });
  });

  it('refreshes the CSRF token from the accepted response envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { token: 'csrf-token-1' } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshCsrfToken()).resolves.toBe('csrf-token-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/csrf',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('shares one in-flight current member request between bootstrap and callback confirmation', async () => {
    let finishRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = getCurrentMember();
    const second = getCurrentMember();
    await vi.waitFor(() => expect(finishRequest).toBeTypeOf('function'));
    finishRequest(new Response(JSON.stringify({ data: member })));

    await expect(Promise.all([first, second])).resolves.toEqual([member, member]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
