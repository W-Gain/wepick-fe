import { z } from 'zod';

import { apiRequest, ApiError, refreshCsrfToken } from '../../shared/api/client';
import { apiDataResponseAdapter } from '../../shared/api/responseAdapter';
import type { AuthStatus } from './authFlow';

export const currentMemberSchema = z.object({
  id: z.number().int().positive(),
  nickname: z.string().min(1),
  profileImageUrl: z.string().nullable(),
});

export type CurrentMember = z.infer<typeof currentMemberSchema>;

export const currentMemberResponseAdapter = apiDataResponseAdapter(currentMemberSchema);

let currentMemberRequest: Promise<CurrentMember> | null = null;
let currentMemberRequestId = 0;

export function getCurrentMember() {
  if (currentMemberRequest) return currentMemberRequest;

  const requestId = ++currentMemberRequestId;
  const request = apiRequest<CurrentMember>('/me', {
    method: 'GET',
    responseAdapter: currentMemberResponseAdapter,
  }).finally(() => {
    if (currentMemberRequestId === requestId) currentMemberRequest = null;
  });
  currentMemberRequest = request;
  return request;
}

export async function resolveCurrentSessionStatus(): Promise<AuthStatus> {
  try {
    await getCurrentMember();
    return 'authenticated';
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return 'anonymous';
    throw error;
  }
}

export { refreshCsrfToken };
