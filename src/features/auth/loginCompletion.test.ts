import { describe, expect, it, vi } from 'vitest';

import {
  LOGIN_ATTEMPT_TTL_MS,
  normalizeLoginReturnTo,
  startKakaoLogin,
  type StoredLoginAttempt,
} from './loginStart';
import { consumeLoginCompletion } from './loginCompletion';

const attempt = '76e4a987-54c9-45ce-8b16-d2ceeb89fa31';
const origin = 'https://wepick.test';
const returnTo = '/profile?from=history#top';
const key = `wepick:login-attempt:${attempt}`;

function createStorage(record = validRecord()) {
  const values = new Map([[key, JSON.stringify(record)]]);
  return {
    getItem: vi.fn((storageKey: string) => values.get(storageKey) ?? null),
    removeItem: vi.fn((storageKey: string) => values.delete(storageKey)),
    values,
  };
}

function validRecord(): StoredLoginAttempt {
  return {
    version: 1 as const,
    attempt,
    createdAt: 1000,
    expiresAt: 1000 + LOGIN_ATTEMPT_TTL_MS,
    intent: { action: 'view-profile' as const, returnTo },
  };
}

function callbackQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({ attempt, returnTo, result: 'success', ...overrides }).toString();
}

describe('consumeLoginCompletion', () => {
  it('확인한 회원 복귀 정보만 반환하고 해당 탭 시도 기록을 정리한다', () => {
    const storage = createStorage();

    expect(consumeLoginCompletion(callbackQuery(), storage, 2000, origin)).toEqual({
      attempt,
      returnTo,
      result: 'success',
      intent: validRecord().intent,
    });
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(storage.values.has(key)).toBe(false);
  });

  it.each(['cancelled', 'failed'])('결과가 %s여도 유효한 시도 기록을 소비한다', (result) => {
    const storage = createStorage();

    expect(consumeLoginCompletion(callbackQuery({ result }), storage, 2000, origin)?.result).toBe(
      result,
    );
    expect(storage.values.has(key)).toBe(false);
  });

  it.each([
    ['code 유입', callbackQuery() + '&code=secret'],
    ['state 유입', callbackQuery() + '&state=secret'],
    ['알 수 없는 값', callbackQuery() + '&debug=1'],
    ['외부 returnTo', callbackQuery({ returnTo: 'https://evil.test/' })],
    ['returnTo 불일치', callbackQuery({ returnTo: '/' })],
    ['결과 누락', new URLSearchParams({ attempt, returnTo }).toString()],
    ['결과 중복', callbackQuery() + '&result=failed'],
    ['지원하지 않는 병합 표시', callbackQuery({ merge: 'other' })],
  ])('%s을 거부하고 일치한 attempt 기록은 정리한다', (_label, search) => {
    const storage = createStorage();

    expect(consumeLoginCompletion(search, storage, 2000, origin)).toBeNull();
    expect(storage.values.has(key)).toBe(false);
  });

  it('같은 attempt가 중복이면 요청을 거부하고 해당 탭 기록을 정리한다', () => {
    const storage = createStorage();

    expect(
      consumeLoginCompletion(`${callbackQuery()}&attempt=${attempt}`, storage, 2000, origin),
    ).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(storage.values.has(key)).toBe(false);
  });

  it('서로 다른 attempt가 중복이면 어느 기록도 임의로 소비하지 않는다', () => {
    const storage = createStorage();
    const otherAttempt = 'd5aeb00f-c8f0-4edc-b5b4-2bf9724e70ea';

    expect(
      consumeLoginCompletion(`${callbackQuery()}&attempt=${otherAttempt}`, storage, 2000, origin),
    ).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('만료된 attempt는 복구하지 않고 지운다', () => {
    const storage = createStorage({ ...validRecord(), expiresAt: 1500 });

    expect(consumeLoginCompletion(callbackQuery(), storage, 2000, origin)).toBeNull();
    expect(storage.values.has(key)).toBe(false);
  });

  it('일치하는 sessionStorage 항목이 없으면 callback query를 신뢰하지 않는다', () => {
    const storage = createStorage();
    storage.values.clear();

    expect(consumeLoginCompletion(callbackQuery(), storage, 2000, origin)).toBeNull();
  });

  it('300 Unicode codepoint 의견 초안(emoji 포함)을 저장하고 callback에서 그대로 복원한다', () => {
    const draft = '😀'.repeat(300);
    const storage = createStorage({
      ...validRecord(),
      intent: { action: 'write-opinion', returnTo, targetId: 'pick-12', draft },
    });

    const completion = consumeLoginCompletion(callbackQuery(), storage, 2000, origin);

    expect(completion?.intent.draft).toBe(draft);
    expect([...completion!.intent.draft!]).toHaveLength(300);
  });

  it('301 Unicode codepoint 의견 초안은 복원하지 않고 지운다', () => {
    const storage = createStorage({
      ...validRecord(),
      intent: { action: 'write-opinion', returnTo, targetId: 'pick-12', draft: '😀'.repeat(301) },
    });

    expect(consumeLoginCompletion(callbackQuery(), storage, 2000, origin)).toBeNull();
    expect(storage.values.has(key)).toBe(false);
  });

  it('로그인 시작 주소를 Java URI canonical 형태로 저장해 callback에서 왕복한다', async () => {
    const inputReturnTo = '/picks/../profile?query=한글&plus=+&escaped=%2f&literal=%25#tab+%25';
    const canonicalReturnTo =
      '/profile?query=%ED%95%9C%EA%B8%80&plus=+&escaped=%2f&literal=%25#tab+%25';
    const draft = '😀'.repeat(300);
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((storageKey: string) => values.get(storageKey) ?? null),
      setItem: vi.fn((storageKey: string, value: string) => values.set(storageKey, value)),
      removeItem: vi.fn((storageKey: string) => values.delete(storageKey)),
    };
    const navigate = vi.fn();
    const lockManager = {
      request: async (_name: string, _options: LockOptions, callback: (lock: Lock) => unknown) =>
        callback({} as Lock),
    } as unknown as LockManager;

    await startKakaoLogin(
      { action: 'write-opinion', returnTo: inputReturnTo, targetId: 'pick-12', draft },
      new AbortController().signal,
      {
        storage,
        lockManager,
        fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
        navigate,
        createAttemptId: () => attempt,
        now: () => 1000,
        origin,
      },
    );

    const startUrl = new URL(navigate.mock.calls[0]![0]);
    expect(normalizeLoginReturnTo(inputReturnTo, origin)).toBe(canonicalReturnTo);
    expect(startUrl.searchParams.get('returnTo')).toBe(canonicalReturnTo);
    const storedRecord = JSON.parse(values.get(key)!);
    expect(storedRecord.intent.returnTo).toBe(canonicalReturnTo);
    expect(storedRecord.intent.draft).toBe(draft);

    const callbackParams = new URLSearchParams({
      attempt,
      returnTo: startUrl.searchParams.get('returnTo')!,
      result: 'success',
    });
    const completion = consumeLoginCompletion(callbackParams.toString(), storage, 2000, origin);
    expect(completion?.returnTo).toBe(canonicalReturnTo);
    expect(completion?.intent.draft).toBe(draft);
    expect(values.has(key)).toBe(false);
  });
});
