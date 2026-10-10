import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../app/router';
import { AuthFlowProvider } from '../features/auth/AuthFlowProvider';
import { useAuthFlow } from '../features/auth/authFlow';
import { LOGIN_ATTEMPT_TTL_MS } from '../features/auth/loginStart';
import { clearCsrfToken } from '../shared/api/client';
import { ToastProvider } from '../shared/ui';

const attempt = '76e4a987-54c9-45ce-8b16-d2ceeb89fa31';
const member = { id: 7, nickname: '말랑구름', profileImageUrl: null };
const testRoutes = [...routes, { path: '/callback-test-return', element: <p>복귀 화면</p> }];

function AuthStatusProbe() {
  const { status } = useAuthFlow();
  return <output data-testid="auth-status">{status}</output>;
}

function seedAttempt(returnTo = '/profile') {
  const storageKey = `wepick:login-attempt:${attempt}`;
  const createdAt = Date.now() - 1000;
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      attempt,
      createdAt,
      expiresAt: createdAt + LOGIN_ATTEMPT_TTL_MS,
      intent: { action: 'view-profile', returnTo },
    }),
  );
  return storageKey;
}

function callbackUrl(returnTo: string, result: 'success' | 'cancelled' | 'failed' = 'success') {
  const callbackParams = new URLSearchParams({ attempt, returnTo, result });
  return `/auth/complete?${callbackParams.toString()}`;
}

function renderAuthApp(
  router: ReturnType<typeof createMemoryRouter>,
  queryClient: QueryClient,
  initialStatus: 'unknown' | 'anonymous' = 'unknown',
) {
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthFlowProvider initialStatus={initialStatus}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
          <AuthStatusProbe />
        </AuthFlowProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('/auth/complete', () => {
  it('실제 /api/me와 CSRF 확인 뒤 복귀 화면으로 이동한다', async () => {
    const returnTo = '/profile';
    const storageKey = seedAttempt(returnTo);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/me') return Promise.resolve(new Response(JSON.stringify({ data: member })));
      if (url === '/api/csrf') {
        return Promise.resolve(new Response(JSON.stringify({ data: { token: 'fresh-csrf' } })));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const router = createMemoryRouter(testRoutes, {
      initialEntries: [
        `${callbackUrl(returnTo)}&${new URLSearchParams({ merge: 'kept_member_vote' })}`,
      ],
    });

    renderAuthApp(router, queryClient, 'anonymous');

    expect(await screen.findByRole('heading', { name: '프로필' })).toBeInTheDocument();
    expect(await screen.findByText('말랑구름')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/me', '/api/csrf']);
    expect(router.state.location.state).toMatchObject({
      loginRecovery: {
        intent: { action: 'view-profile', returnTo },
        result: 'success',
        sessionConfirmed: true,
        merge: 'kept_member_vote',
      },
    });
  });

  it('callback success만으로는 인증 처리하지 않고 /api/me 401이면 로그인 상태를 유지한다', async () => {
    const returnTo = '/callback-test-return';
    const storageKey = seedAttempt(returnTo);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(testRoutes, {
      initialEntries: [callbackUrl(returnTo)],
    });

    renderAuthApp(router, queryClient);

    expect(await screen.findByText('복귀 화면')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/callback-test-return');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.anything());
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    expect(await screen.findByText('로그인 뒤 회원 세션이 확인되지 않았어요.')).toBeInTheDocument();
    expect(router.state.location.state).toMatchObject({
      loginRecovery: { result: 'success', sessionConfirmed: false },
    });
  });

  it.each([
    ['cancelled', '로그인을 취소했어요.'],
    ['failed', '로그인하지 못했어요. 다시 시도해 주세요.'],
  ] as const)('%s 결과의 /api/me 401은 예상 비로그인으로 처리한다', async (result, message) => {
    seedAttempt('/callback-test-return');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(testRoutes, {
      initialEntries: [callbackUrl('/callback-test-return', result)],
    });

    renderAuthApp(router, queryClient);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
    expect(screen.queryByText('로그인 상태를 확인하지 못했어요.')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/me']);
    expect(router.state.location.state).toMatchObject({
      loginRecovery: { result, sessionConfirmed: false },
    });
  });

  it('success의 /api/me 서버 오류는 401과 구분해 세션을 unavailable로 둔다', async () => {
    seedAttempt('/callback-test-return');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(testRoutes, {
      initialEntries: [callbackUrl('/callback-test-return')],
    });

    renderAuthApp(router, queryClient);

    expect(await screen.findByText('로그인 상태를 확인하지 못했어요.')).toBeInTheDocument();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('unavailable');
    expect(screen.queryByText('로그인 뒤 회원 세션이 확인되지 않았어요.')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/me']);
    expect(router.state.location.state).toMatchObject({
      loginRecovery: { result: 'success', sessionConfirmed: false },
    });
  });

  it('/api/me 성공 뒤 CSRF 갱신 실패를 인증 성공과 분리하고 다음 변경 시 다시 시도한다', async () => {
    seedAttempt();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: member })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const router = createMemoryRouter(routes, { initialEntries: [callbackUrl('/profile')] });

    renderAuthApp(router, queryClient);

    expect(
      await screen.findByText('로그인은 확인했지만 변경 요청 준비를 마치지 못했어요.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('말랑구름')).toBeInTheDocument();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(router.state.location.pathname).toBe('/profile');
    expect(router.state.location.state).toMatchObject({
      loginRecovery: { result: 'success', sessionConfirmed: true },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/me', '/api/csrf']);
  });

  it('세션 확인이 대기 중 다른 화면으로 이동하면 늦게 도착한 /api/me 결과를 반영하지 않는다', async () => {
    seedAttempt();
    let finishMe!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishMe = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: [callbackUrl('/profile')] });

    renderAuthApp(router, queryClient);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.anything()));
    await act(async () => router.navigate('/profile'));
    finishMe(new Response(JSON.stringify({ data: member })));

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('unknown');
    expect(queryClient.getQueryData(['member-profile'])).toBeUndefined();
    expect(screen.queryByText('로그인했어요.')).not.toBeInTheDocument();
  });

  it('CSRF 확인이 대기 중 다른 화면으로 이동하면 늦은 안내나 복귀 이동을 하지 않는다', async () => {
    seedAttempt();
    let finishCsrf!: (response: Response) => void;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/me') return Promise.resolve(new Response(JSON.stringify({ data: member })));
      return new Promise<Response>((resolve) => {
        finishCsrf = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const router = createMemoryRouter(routes, { initialEntries: [callbackUrl('/profile')] });

    renderAuthApp(router, queryClient);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/csrf', expect.anything()));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    await act(async () => router.navigate('/profile'));
    finishCsrf(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    expect(
      screen.queryByText('로그인은 확인했지만 변경 요청 준비를 마치지 못했어요.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('로그인했어요.')).not.toBeInTheDocument();
  });
});
