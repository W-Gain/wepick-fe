import { describe, expect, it, vi } from 'vitest';

import type { LoginIntent } from './authFlow';
import {
  LOGIN_ATTEMPT_TTL_MS,
  LOGIN_PREPARE_LOCK_NAME,
  startKakaoLogin,
  type LoginStartDependencies,
} from './loginStart';

const STORAGE_PREFIX = 'wepick:login-attempt:';
const intent: LoginIntent = {
  action: 'write-opinion',
  returnTo: '/picks/12?from=archive#opinions',
  targetId: 'private-target-12',
  draft: '비공개로 보관할 의견',
};

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

function createLocks() {
  return {
    request: vi.fn(async (_name, _options, callback) => callback({} as Lock)),
  } as unknown as LockManager & { request: ReturnType<typeof vi.fn> };
}

type TestDependencies = {
  storage: ReturnType<typeof createStorage>;
  lockManager: LockManager | null;
  fetcher: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  createAttemptId: ReturnType<typeof vi.fn>;
  now: () => number;
  origin: string;
};

function dependencies(overrides: Partial<TestDependencies> = {}): TestDependencies {
  return {
    storage: createStorage(),
    lockManager: createLocks(),
    fetcher: vi.fn().mockResolvedValue({ status: 204, json: vi.fn() }),
    navigate: vi.fn(),
    createAttemptId: vi.fn(() => '76e4a987-54c9-45ce-8b16-d2ceeb89fa31'),
    now: () => 1000,
    origin: 'https://wepick.test',
    ...overrides,
  };
}

function runLoginStart(
  signal: AbortSignal,
  deps: TestDependencies,
  nextIntent: LoginIntent = intent,
) {
  const typedDependencies: LoginStartDependencies = {
    storage: deps.storage,
    lockManager: deps.lockManager,
    fetcher: deps.fetcher as unknown as typeof fetch,
    navigate: deps.navigate as unknown as (url: string) => void,
    createAttemptId: deps.createAttemptId as () => string,
    now: deps.now,
    origin: deps.origin,
  };
  return startKakaoLogin(nextIntent, signal, typedDependencies);
}

describe('startKakaoLogin', () => {
  it('탭별 복귀 정보를 저장한 뒤 쿠키 준비가 끝나면 개인정보 없이 start URL로 이동한다', async () => {
    const response = { status: 204, json: vi.fn() };
    const deps = dependencies({ fetcher: vi.fn().mockResolvedValue(response) });
    const signal = new AbortController().signal;

    await runLoginStart(signal, deps);

    const attempt = '76e4a987-54c9-45ce-8b16-d2ceeb89fa31';
    const stored = JSON.parse(deps.storage.values.get(`${STORAGE_PREFIX}${attempt}`)!);
    expect(stored).toEqual({
      version: 1,
      attempt,
      createdAt: 1000,
      expiresAt: 1000 + LOGIN_ATTEMPT_TTL_MS,
      intent,
    });
    expect(vi.mocked(deps.lockManager!.request)).toHaveBeenCalledWith(
      LOGIN_PREPARE_LOCK_NAME,
      expect.objectContaining({ mode: 'exclusive', signal }),
      expect.any(Function),
    );
    expect(deps.fetcher).toHaveBeenCalledWith(
      '/api/auth/kakao/prepare',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      }),
    );
    expect(deps.navigate).toHaveBeenCalledOnce();

    const navigationCall = deps.navigate.mock.calls[0]!;
    const startUrl = new URL(navigationCall[0]);
    expect(startUrl.pathname).toBe('/api/auth/kakao/start');
    expect(startUrl.searchParams.get('attempt')).toBe(attempt);
    expect(startUrl.searchParams.get('returnTo')).toBe(intent.returnTo);
    expect(startUrl.href).not.toContain(intent.targetId);
    expect(startUrl.href).not.toContain(intent.draft);
    expect(response.json).not.toHaveBeenCalled();
  });

  it('Web Locks를 쓸 수 없으면 저장·요청·이동 없이 안전하게 실패한다', async () => {
    const deps = dependencies({ lockManager: null });

    await expect(runLoginStart(new AbortController().signal, deps)).rejects.toThrow(
      'Cross-tab login preparation is unavailable.',
    );

    expect(deps.storage.setItem).not.toHaveBeenCalled();
    expect(deps.fetcher).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('301 Unicode codepoint 의견 초안은 attempt를 저장하기 전에 거부한다', async () => {
    const deps = dependencies();

    await expect(
      runLoginStart(new AbortController().signal, deps, { ...intent, draft: '😀'.repeat(301) }),
    ).rejects.toThrow('300 Unicode code points.');

    expect(deps.storage.setItem).not.toHaveBeenCalled();
    expect(deps.fetcher).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('prepare 응답을 기다리는 동안 lock을 유지하고 해제한 뒤 이동한다', async () => {
    let finishPrepare!: (response: { status: number }) => void;
    let activeLockCount = 0;
    let lockReleased = false;
    const lockManager = {
      request: async (_name: string, _options: LockOptions, callback: () => Promise<void>) => {
        activeLockCount += 1;
        try {
          return await callback();
        } finally {
          activeLockCount -= 1;
          lockReleased = true;
        }
      },
    } as unknown as LockManager;
    const fetcher = vi.fn(
      () =>
        new Promise<{ status: number }>((resolve) => {
          finishPrepare = resolve;
        }),
    );
    const navigate = vi.fn(() => {
      expect(activeLockCount).toBe(0);
      expect(lockReleased).toBe(true);
    });
    const deps = dependencies({ lockManager, fetcher, navigate });
    const pending = runLoginStart(new AbortController().signal, deps);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(activeLockCount).toBe(1);
    expect(navigate).not.toHaveBeenCalled();

    finishPrepare({ status: 204 });
    await expect(pending).resolves.toBe('76e4a987-54c9-45ce-8b16-d2ceeb89fa31');
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('prepare 응답이 204가 아니면 이번 attempt만 지우고 다른 탭의 복귀 정보는 보존한다', async () => {
    const deps = dependencies({
      fetcher: vi.fn().mockResolvedValue({ status: 409 }),
    });
    const otherAttemptKey = `${STORAGE_PREFIX}older-attempt-0123456789`;
    deps.storage.values.set(otherAttemptKey, '{"attempt":"older-attempt-0123456789"}');

    await expect(runLoginStart(new AbortController().signal, deps)).rejects.toThrow(
      'Login preparation failed (409).',
    );

    expect(deps.storage.values.has(`${STORAGE_PREFIX}76e4a987-54c9-45ce-8b16-d2ceeb89fa31`)).toBe(
      false,
    );
    expect(deps.storage.values.get(otherAttemptKey)).toBe('{"attempt":"older-attempt-0123456789"}');
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('두 탭의 쿠키 준비만 직렬화하고 서로 다른 attempt로 각각 로그인 이동한다', async () => {
    const storage = createStorage();
    let lockTail = Promise.resolve();
    let activePrepareCount = 0;
    let maximumPrepareCount = 0;
    const lockManager = {
      request: async (_name: string, _options: LockOptions, callback: () => Promise<void>) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        activePrepareCount += 1;
        maximumPrepareCount = Math.max(maximumPrepareCount, activePrepareCount);
        try {
          return await callback();
        } finally {
          activePrepareCount -= 1;
          release();
        }
      },
    } as unknown as LockManager;
    const fetcher = vi.fn().mockResolvedValue({ status: 204 });
    const navigate = vi.fn();
    const createAttemptId = vi
      .fn()
      .mockReturnValueOnce('76e4a987-54c9-45ce-8b16-d2ceeb89fa31')
      .mockReturnValueOnce('d5aeb00f-c8f0-4edc-b5b4-2bf9724e70ea');
    const shared = {
      storage,
      lockManager,
      fetcher: fetcher as unknown as typeof fetch,
      navigate,
      createAttemptId,
      origin: 'https://wepick.test',
    };

    await Promise.all([
      startKakaoLogin(intent, new AbortController().signal, shared),
      startKakaoLogin({ ...intent, returnTo: '/profile' }, new AbortController().signal, shared),
    ]);

    expect(maximumPrepareCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(storage.values.size).toBe(2);
    const attemptIds = navigate.mock.calls.map((call) =>
      new URL(call[0]).searchParams.get('attempt'),
    );
    expect(new Set(attemptIds).size).toBe(2);
  });

  it('취소된 prepare가 늦게 끝나도 페이지 이동하지 않고 저장한 attempt를 정리한다', async () => {
    let finishPrepare!: (response: { status: number }) => void;
    const deps = dependencies({
      fetcher: vi.fn(
        () =>
          new Promise<{ status: number }>((resolve) => {
            finishPrepare = resolve;
          }),
      ),
    });
    const controller = new AbortController();
    const pending = runLoginStart(controller.signal, deps);

    await vi.waitFor(() => expect(finishPrepare).toBeTypeOf('function'));
    controller.abort();
    finishPrepare({ status: 204 });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.storage.values.size).toBe(0);
  });

  it('저장소가 일부 기록한 뒤 실패하면 새 항목만 제거하고 prepare를 시작하지 않는다', async () => {
    const deps = dependencies();
    deps.storage.setItem.mockImplementation((key, value) => {
      deps.storage.values.set(key, value);
      throw new Error('quota');
    });

    await expect(runLoginStart(new AbortController().signal, deps)).rejects.toThrow('quota');

    expect(deps.storage.values.size).toBe(0);
    expect(deps.fetcher).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});
