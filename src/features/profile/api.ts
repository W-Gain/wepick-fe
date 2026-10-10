import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { dataMode } from '../../app/enableMocking';
import type { MemberProfile } from '../../shared/contracts';
import { memberProfileSchema } from '../../shared/contracts';
import { apiRequest, clearCsrfToken, refreshCsrfToken } from '../../shared/api/client';
import { apiDataResponseAdapter, schemaResponseAdapter } from '../../shared/api/responseAdapter';
import { useAuthFlow } from '../auth/authFlow';
import { getCurrentMember, type CurrentMember } from '../auth/api';
import { memberProfileResponseAdapter } from './responseAdapters';

const useMockApi = dataMode === 'mock' || import.meta.env.MODE === 'test';
const legacyProfileUserSchema = z.object({
  userId: z.number().int().positive(),
  email: z.email(),
  profileImageUrl: z.string().nullable(),
  nickname: z.string().min(1),
});
const legacyProfileUpdateAdapter = apiDataResponseAdapter(legacyProfileUserSchema);
const nicknameCheckAdapter = apiDataResponseAdapter(z.object({ isExisted: z.boolean() }));
const imageUploadAdapter = apiDataResponseAdapter(
  z.object({
    imageId: z.number().int().positive(),
    key: z.string().min(1),
    url: z.string().min(1),
  }),
);

export function toMemberProfile(user: CurrentMember): MemberProfile {
  return memberProfileSchema.parse({
    id: String(user.id),
    nickname: user.nickname,
    profileImage: user.profileImageUrl
      ? { kind: 'url', url: user.profileImageUrl }
      : { kind: 'default', key: 'wepick-default' },
  });
}

export async function getMemberProfile(): Promise<MemberProfile> {
  return toMemberProfile(await getCurrentMember());
}

export function logoutCurrentSession() {
  return apiRequest<null>('/auth/logout', {
    method: 'POST',
    responseAdapter: schemaResponseAdapter(z.null()),
  });
}

export async function isNicknameAvailable(nickname: string) {
  const result = await apiRequest('/users/check-nickname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
    responseAdapter: nicknameCheckAdapter,
  });
  return !result.isExisted;
}

export function useNicknameAvailability(nickname: string, enabled: boolean) {
  return useQuery({
    queryKey: ['nickname-availability', nickname],
    enabled: enabled && !useMockApi,
    queryFn: () => isNicknameAvailable(nickname),
    retry: false,
  });
}

export async function uploadProfileImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiRequest('/images/profile', {
    method: 'POST',
    body: form,
    responseAdapter: imageUploadAdapter,
  });
}

export async function saveProfileChanges(changes: { nickname?: string; file?: File }) {
  const { nickname, file } = changes;
  if (!nickname && !file) throw new Error('At least one profile change is required.');

  let path: string;
  let body:
    | { nickname: string; profileImageId: number }
    | { nickname: string }
    | { profileImageId: number };
  if (file) {
    const { imageId } = await uploadProfileImage(file);
    if (nickname) {
      path = '/users/me';
      body = { nickname, profileImageId: imageId };
    } else {
      path = '/users/me/profile-image';
      body = { profileImageId: imageId };
    }
  } else {
    path = '/users/me/nickname';
    body = { nickname: nickname! };
  }

  const updated = await apiRequest(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    responseAdapter: legacyProfileUpdateAdapter,
  });
  return toMemberProfile({
    id: updated.userId,
    nickname: updated.nickname,
    profileImageUrl: updated.profileImageUrl,
  });
}

export function useMemberProfile() {
  const { status } = useAuthFlow();
  return useQuery({
    queryKey: ['member-profile'],
    enabled: status === 'authenticated',
    queryFn: () =>
      useMockApi
        ? apiRequest<MemberProfile>('/__mock/members/me', {
            method: 'GET',
            responseAdapter: memberProfileResponseAdapter,
          })
        : getMemberProfile(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const { setStatus } = useAuthFlow();

  return useMutation({
    mutationFn: () => (useMockApi ? Promise.resolve(null) : logoutCurrentSession()),
    onSuccess: () => {
      if (!useMockApi) {
        void refreshCsrfToken().catch(() => clearCsrfToken());
      }
      setStatus('anonymous');
      queryClient.removeQueries({ queryKey: ['member-profile'] });
      queryClient.removeQueries({ queryKey: ['vote-history'] });
      queryClient.removeQueries({ queryKey: ['pick'] });
      queryClient.removeQueries({ queryKey: ['picks'] });
      queryClient.removeQueries({ queryKey: ['pick-opinions'] });
    },
  });
}
