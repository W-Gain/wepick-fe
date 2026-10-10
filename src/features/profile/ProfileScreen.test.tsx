import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthFlowProvider } from '../auth/AuthFlowProvider';
import { getCurrentMember } from '../auth/api';
import { useAuthFlow } from '../auth/authFlow';
import { clearCsrfToken, refreshCsrfToken } from '../../shared/api/client';
import { ToastProvider } from '../../shared/ui';
import { logoutCurrentSession, toMemberProfile } from './api';
import { ProfileEditScreen } from './ProfileEditScreen';
import { ProfileScreen } from './ProfileScreen';

const oldMember = {
  id: '7',
  nickname: '이전회원',
  profileImage: { kind: 'default' as const, key: 'wepick-default' },
};
const nextMember = { id: 8, nickname: '새회원', profileImageUrl: null };
const preservedDraft = '인증 만료 전 작성한 의견';

function SessionProbe() {
  const { status, pendingIntent, beginLogin, setStatus } = useAuthFlow();
  const queryClient = useQueryClient();

  async function confirmNewSession() {
    const member = await getCurrentMember({ bypassInFlight: true });
    setStatus('authenticated');
    queryClient.setQueryData(['member-profile'], toMemberProfile(member));
  }

  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <output data-testid="pending-draft">{pendingIntent?.draft ?? ''}</output>
      <button
        data-testid="preserve-draft"
        onClick={() =>
          beginLogin({ action: 'write-opinion', returnTo: '/', draft: preservedDraft })
        }
      />
      <button data-testid="sign-in-again" onClick={() => setStatus('authenticated')} />
      <button data-testid="confirm-new-session" onClick={() => void confirmNewSession()} />
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-path">{location.pathname}</output>;
}

function renderProfile(pathname = '/profile', prepareClient?: (queryClient: QueryClient) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, staleTime: 0 } },
  });
  prepareClient?.(queryClient);

  render(
    <MemoryRouter initialEntries={[pathname]}>
      <LocationProbe />
      <QueryClientProvider client={queryClient}>
        <AuthFlowProvider initialStatus="authenticated">
          <SessionProbe />
          <ToastProvider>
            <Routes>
              <Route path="/profile" element={<ProfileScreen />} />
              <Route path="/profile/edit" element={<ProfileEditScreen />} />
            </Routes>
          </ToastProvider>
        </AuthFlowProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return { queryClient };
}

function apiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('ProfileScreen session expiry', () => {
  it('늦게 도착한 이전 /api/me 401은 새로 확인된 로그인과 회원 캐시를 되돌리지 않는다', async () => {
    let finishOldMe!: (response: Response) => void;
    let meRequests = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url !== '/api/me') throw new Error(`Unexpected request: ${url}`);
      meRequests += 1;
      if (meRequests === 1) {
        return new Promise<Response>((resolve) => {
          finishOldMe = resolve;
        });
      }
      return Promise.resolve(apiResponse({ data: nextMember }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderProfile('/profile', (client) => {
      client.setQueryData(['member-profile'], oldMember, { updatedAt: 0 });
    });

    await waitFor(() => expect(meRequests).toBe(1));
    fireEvent.click(screen.getByTestId('confirm-new-session'));

    expect(await screen.findByText(nextMember.nickname)).toBeInTheDocument();
    expect(queryClient.getQueryData(['member-profile'])).toMatchObject({
      id: String(nextMember.id),
      nickname: nextMember.nickname,
    });
    expect(meRequests).toBe(2);

    await act(async () => {
      finishOldMe(apiResponse({ error: { code: 'UNAUTHENTICATED' } }, 401));
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(screen.queryByRole('dialog', { name: '로그인이 필요해요' })).not.toBeInTheDocument();
    expect(screen.getByText(nextMember.nickname)).toBeInTheDocument();
    expect(screen.queryByText(oldMember.nickname)).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['member-profile'])).toMatchObject({
      id: String(nextMember.id),
      nickname: nextMember.nickname,
    });
  });

  it('만료된 실제 /api/me 401은 로그인 안내로 전환하고 세션 캐시·CSRF를 지우되 초안은 유지한다', async () => {
    let finishMe!: (response: Response) => void;
    let meRequests = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/csrf') {
        const token = fetchMock.mock.calls.filter(
          ([calledUrl]) => calledUrl === '/api/csrf',
        ).length;
        return Promise.resolve(
          apiResponse({ data: { token: token === 1 ? 'old-csrf' : 'fresh-csrf' } }),
        );
      }
      if (url === '/api/me') {
        meRequests += 1;
        if (meRequests === 1) {
          return new Promise<Response>((resolve) => {
            finishMe = resolve;
          });
        }
        return Promise.resolve(apiResponse({ data: nextMember }));
      }
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await refreshCsrfToken();

    const { queryClient } = renderProfile('/profile', (client) => {
      client.setQueryData(['member-profile'], oldMember, { updatedAt: 0 });
      client.setQueryData(['vote-history'], { items: ['old-member-vote'] });
      client.setQueryData(['pick', 'today'], { myVote: 'A' });
      client.setQueryData(['picks'], { items: ['old-member-pick'] });
      client.setQueryData(['pick-opinions', 'today'], { items: ['old-member-opinion'] });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.anything()));
    fireEvent.click(screen.getByTestId('preserve-draft'));
    await act(async () => {
      finishMe(apiResponse({ error: { code: 'UNAUTHENTICATED' } }, 401));
    });

    expect(await screen.findByRole('dialog', { name: '로그인이 필요해요' })).toBeInTheDocument();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    expect(screen.getByTestId('pending-draft')).toHaveTextContent(preservedDraft);
    expect(screen.queryByText(oldMember.nickname)).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['member-profile'])).toBeUndefined();
    expect(queryClient.getQueryData(['vote-history'])).toBeUndefined();
    expect(queryClient.getQueryData(['pick', 'today'])).toBeUndefined();
    expect(queryClient.getQueryData(['picks'])).toBeUndefined();
    expect(queryClient.getQueryData(['pick-opinions', 'today'])).toBeUndefined();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/me')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/csrf')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(false);

    await logoutCurrentSession();
    const logoutCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/logout');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/csrf')).toHaveLength(2);
    expect(logoutCalls).toHaveLength(1);
    expect(new Headers(logoutCalls[0]?.[1]?.headers).get('X-CSRF-Token')).toBe('fresh-csrf');

    act(() => fireEvent.click(screen.getByTestId('sign-in-again')));
    expect(await screen.findByText(nextMember.nickname)).toBeInTheDocument();
    expect(screen.queryByText(oldMember.nickname)).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['member-profile'])).toMatchObject({
      id: String(nextMember.id),
      nickname: nextMember.nickname,
    });
  });

  it('/profile/edit의 /api/me 401은 편집 화면을 /profile 로그인 안내로 보낸다', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/me') {
        return Promise.resolve(apiResponse({ error: { code: 'UNAUTHENTICATED' } }, 401));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProfile('/profile/edit');

    expect(await screen.findByRole('dialog', { name: '로그인이 필요해요' })).toBeInTheDocument();
    expect(screen.getByTestId('route-path')).toHaveTextContent('/profile');
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/me')).toHaveLength(1);
  });

  it.each([
    ['5xx', () => Promise.resolve(apiResponse({ error: { code: 'UNAVAILABLE' } }, 503))],
    ['네트워크', () => Promise.reject(new TypeError('Network error'))],
  ] as const)(
    '%s 프로필 조회 오류는 로그인 상태를 유지하고 재시도를 허용한다',
    async (_kind, fail) => {
      let meRequests = 0;
      const fetchMock = vi.fn((url: string) => {
        if (url !== '/api/me') throw new Error(`Unexpected request: ${url}`);
        meRequests += 1;
        return meRequests <= 2 ? fail() : Promise.resolve(apiResponse({ data: nextMember }));
      });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();

      renderProfile();

      expect(await screen.findByText('프로필을 불러오지 못했어요')).toBeInTheDocument();
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
      expect(screen.queryByRole('dialog', { name: '로그인이 필요해요' })).not.toBeInTheDocument();
      expect(meRequests).toBe(2);
      await user.click(screen.getByRole('button', { name: '다시 시도' }));

      expect(await screen.findByText(nextMember.nickname)).toBeInTheDocument();
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
      expect(meRequests).toBe(3);
    },
  );
});
