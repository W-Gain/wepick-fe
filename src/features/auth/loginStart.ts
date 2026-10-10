import type { LoginIntent } from './authFlow';

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;
export const LOGIN_PREPARE_LOCK_NAME = 'wepick-kakao-login-prepare';
export const LOGIN_DRAFT_MAX_CODE_POINTS = 300;
const LOGIN_ATTEMPT_STORAGE_PREFIX = 'wepick:login-attempt:';

export type StoredLoginAttempt = {
  version: 1;
  attempt: string;
  createdAt: number;
  expiresAt: number;
  intent: LoginIntent;
};

export class LoginPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginPrepareError';
  }
}

type LoginStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoginStartDependencies = {
  storage?: LoginStorage | null;
  lockManager?: Pick<LockManager, 'request'> | null;
  fetcher?: typeof fetch;
  navigate?: (url: string) => void;
  createAttemptId?: () => string;
  now?: () => number;
  origin?: string;
};

function createAttemptId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new LoginPrepareError('Secure random values are unavailable.');
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function validateAttemptId(attempt: string) {
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(attempt)) {
    throw new LoginPrepareError('The login attempt ID is invalid.');
  }
}

export function isValidLoginDraft(draft: string | undefined) {
  return draft === undefined || [...draft].length <= LOGIN_DRAFT_MAX_CODE_POINTS;
}

function normalizePath(path: string) {
  const segments: string[] = [];
  for (const segment of path.split('/').slice(1)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.at(-1) && segments.at(-1) !== '..') segments.pop();
      else segments.push('..');
      continue;
    }
    segments.push(segment);
  }

  const normalized = `/${segments.join('/')}`;
  const hasTrailingSlash = path.endsWith('/') || path.endsWith('/.') || path.endsWith('/..');
  return hasTrailingSlash && normalized !== '/' ? `${normalized}/` : normalized;
}

function toAsciiUriPart(value: string, allowedAscii: string) {
  let result = '';
  for (let index = 0; index < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(index)!);
    const codePoint = character.codePointAt(0)!;
    index += character.length;

    if (character === '%') {
      const escape = value.slice(index, index + 2);
      if (!/^[\da-f]{2}$/i.test(escape)) {
        throw new LoginPrepareError('The login return path contains an invalid escape.');
      }
      result += `%${escape}`;
      index += 2;
      continue;
    }

    if (codePoint <= 0x7f) {
      if (!allowedAscii.includes(character)) {
        throw new LoginPrepareError('The login return path contains an invalid character.');
      }
      result += character;
      continue;
    }

    if (/\p{White_Space}/u.test(character)) {
      throw new LoginPrepareError('The login return path contains whitespace.');
    }
    for (const byte of new TextEncoder().encode(character)) {
      result += `%${byte.toString(16).padStart(2, '0').toUpperCase()}`;
    }
  }
  return result;
}

// 시작 저장값과 callback query를 Java URI.normalize().toASCIIString()과 같은 주소로 맞춘다.
export function normalizeLoginReturnTo(returnTo: string, origin: string) {
  if (
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    returnTo.includes('\\') ||
    [...returnTo].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new LoginPrepareError('The login return path is invalid.');
  }

  const fragmentIndex = returnTo.indexOf('#');
  const beforeFragment = fragmentIndex < 0 ? returnTo : returnTo.slice(0, fragmentIndex);
  const queryIndex = beforeFragment.indexOf('?');
  const path = queryIndex < 0 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  const query = queryIndex < 0 ? '' : beforeFragment.slice(queryIndex + 1);
  const fragment = fragmentIndex < 0 ? '' : returnTo.slice(fragmentIndex + 1);
  const canonical = [
    toAsciiUriPart(
      normalizePath(path),
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/%",
    ),
    ...(queryIndex < 0
      ? []
      : [
          `?${toAsciiUriPart(query, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/?%")}`,
        ]),
    ...(fragmentIndex < 0
      ? []
      : [
          `#${toAsciiUriPart(fragment, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/?%")}`,
        ]),
  ].join('');

  try {
    const base = new URL(origin);
    if (new URL(canonical, base).origin !== base.origin) {
      throw new LoginPrepareError('The login return path must stay on this site.');
    }
  } catch (error) {
    if (error instanceof LoginPrepareError) throw error;
    throw new LoginPrepareError('The login return path is invalid.');
  }

  return canonical;
}

function cleanupAttempt(storage: LoginStorage, key: string, attempt: string) {
  try {
    const stored = storage.getItem(key);
    if (stored && (JSON.parse(stored) as StoredLoginAttempt).attempt === attempt) {
      storage.removeItem(key);
    }
  } catch {
    // 저장소 읽기 실패가 취소된 로그인을 처리하지 못하게 해서는 안 된다.
  }
}

// 탭의 private 복귀 정보를 먼저 저장하고, 브라우저 확인 쿠키 준비만 다른 탭과 직렬화한 뒤
// 해당 탭의 고유 attempt로 Kakao 페이지 이동을 시작한다.
export async function startKakaoLogin(
  intent: LoginIntent,
  signal: AbortSignal,
  dependencies: LoginStartDependencies = {},
) {
  const storage =
    dependencies.storage === undefined ? globalThis.sessionStorage : dependencies.storage;
  const lockManager =
    dependencies.lockManager === undefined ? globalThis.navigator?.locks : dependencies.lockManager;
  if (!storage) throw new LoginPrepareError('Session storage is unavailable.');
  if (!lockManager) throw new LoginPrepareError('Cross-tab login preparation is unavailable.');
  if (signal.aborted) throw new DOMException('Login start was cancelled.', 'AbortError');

  const attempt = (dependencies.createAttemptId ?? createAttemptId)();
  validateAttemptId(attempt);
  const origin = dependencies.origin ?? globalThis.location.origin;
  if (!isValidLoginDraft(intent.draft)) {
    throw new LoginPrepareError(
      `Opinion drafts are limited to ${LOGIN_DRAFT_MAX_CODE_POINTS} Unicode code points.`,
    );
  }
  const normalizedIntent = { ...intent, returnTo: normalizeLoginReturnTo(intent.returnTo, origin) };

  const createdAt = (dependencies.now ?? Date.now)();
  const key = `${LOGIN_ATTEMPT_STORAGE_PREFIX}${attempt}`;
  const record: StoredLoginAttempt = {
    version: 1,
    attempt,
    createdAt,
    expiresAt: createdAt + LOGIN_ATTEMPT_TTL_MS,
    intent: normalizedIntent,
  };

  let writeStarted = false;
  try {
    if (storage.getItem(key) !== null) {
      throw new LoginPrepareError('This login attempt ID is already in use.');
    }
    writeStarted = true;
    storage.setItem(key, JSON.stringify(record));

    // fetch는 Set-Cookie 처리가 끝난 뒤 resolve된다. 첫 방문 탭의 쿠키 초기화 경합을 막도록 응답까지 잠근다.
    await lockManager.request(LOGIN_PREPARE_LOCK_NAME, { mode: 'exclusive', signal }, async () => {
      if (signal.aborted) throw new DOMException('Login start was cancelled.', 'AbortError');
      const response = await (dependencies.fetcher ?? fetch)('/api/auth/kakao/prepare', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (response.status !== 204) {
        throw new LoginPrepareError(`Login preparation failed (${response.status}).`);
      }
    });

    if (signal.aborted) throw new DOMException('Login start was cancelled.', 'AbortError');

    const startUrl = new URL('/api/auth/kakao/start', origin);
    startUrl.search = new URLSearchParams({
      attempt,
      returnTo: normalizedIntent.returnTo,
    }).toString();
    (dependencies.navigate ?? ((url) => globalThis.location.assign(url)))(startUrl.toString());
    return attempt;
  } catch (error) {
    if (writeStarted) cleanupAttempt(storage, key, attempt);
    throw error;
  }
}
