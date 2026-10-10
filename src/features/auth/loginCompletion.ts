import { z } from 'zod';

import {
  isValidLoginDraft,
  LOGIN_ATTEMPT_TTL_MS,
  normalizeLoginReturnTo,
  type StoredLoginAttempt,
} from './loginStart';

const storagePrefix = 'wepick:login-attempt:';
const attemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
const loginIntentSchema = z
  .object({
    action: z.enum([
      'write-opinion',
      'like-opinion',
      'delete-opinion',
      'view-history',
      'view-profile',
    ]),
    returnTo: z.string().min(1),
    targetId: z.string().optional(),
    draft: z.string().refine(isValidLoginDraft).optional(),
  })
  .strict();
const storedAttemptSchema = z
  .object({
    version: z.literal(1),
    attempt: attemptIdSchema,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    intent: loginIntentSchema,
  })
  .strict();

const allowedParams = new Set(['attempt', 'returnTo', 'result', 'merge']);

export type LoginCompletion = {
  attempt: string;
  returnTo: string;
  result: 'success' | 'cancelled' | 'failed';
  merge?: 'kept_member_vote';
  intent: StoredLoginAttempt['intent'];
};

function isCanonicalReturnTo(returnTo: string, origin: string) {
  try {
    return normalizeLoginReturnTo(returnTo, origin) === returnTo;
  } catch {
    return false;
  }
}

function oneValue(params: URLSearchParams, name: string, required: boolean) {
  const values = params.getAll(name);
  if (values.length === 0) return required ? null : undefined;
  if (values.length !== 1) return null;
  return values[0] || null;
}

function matchesAttempt(value: unknown, attempt: string): value is StoredLoginAttempt {
  return Boolean(
    value && typeof value === 'object' && 'attempt' in value && value.attempt === attempt,
  );
}

// callback query는 단일 허용값만 읽고, 일치하는 탭 기록은 어떤 결과에서도 한 번만 소비한다.
export function consumeLoginCompletion(
  search: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null,
  now: number,
  origin: string,
): LoginCompletion | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const attempts = params.getAll('attempt');
  const attempt =
    attempts.length > 0 &&
    attempts.every((value) => value === attempts[0]) &&
    attemptIdSchema.safeParse(attempts[0]).success
      ? attempts[0]
      : null;
  const storageKey = attempt ? `${storagePrefix}${attempt}` : null;
  let matchingAttempt: unknown = null;
  let cleanupFailed = false;
  let completion: LoginCompletion;

  try {
    const raw = storageKey ? storage?.getItem(storageKey) : null;
    if (raw && attempt) {
      const candidate: unknown = JSON.parse(raw);
      if (matchesAttempt(candidate, attempt)) matchingAttempt = candidate;
    }

    if (!storage || !attempt || !matchingAttempt) return null;
    if (attempts.length !== 1) return null;
    if ([...params.keys()].some((key) => !allowedParams.has(key))) return null;

    const returnTo = oneValue(params, 'returnTo', true);
    const result = oneValue(params, 'result', true);
    const merge = oneValue(params, 'merge', false);
    if (!returnTo || !result || !['success', 'cancelled', 'failed'].includes(result)) return null;
    if (merge !== undefined && merge !== 'kept_member_vote') return null;
    if (merge && result !== 'success') return null;
    if (!isCanonicalReturnTo(returnTo, origin)) return null;

    const record = storedAttemptSchema.safeParse(matchingAttempt);
    if (!record.success) return null;
    const value = record.data;
    if (
      value.attempt !== attempt ||
      value.createdAt > now ||
      value.expiresAt <= now ||
      value.expiresAt - value.createdAt !== LOGIN_ATTEMPT_TTL_MS ||
      value.intent.returnTo !== returnTo
    ) {
      return null;
    }

    completion = {
      attempt,
      returnTo,
      result: result as LoginCompletion['result'],
      ...(merge === 'kept_member_vote' ? { merge } : {}),
      intent: value.intent,
    };
  } catch {
    return null;
  } finally {
    if (storage && storageKey && matchingAttempt) {
      try {
        storage.removeItem(storageKey);
      } catch {
        cleanupFailed = true;
      }
    }
  }

  return cleanupFailed ? null : completion;
}
