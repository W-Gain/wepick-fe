import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCsrfToken } from '../../shared/api/client';
import {
  getMemberProfile,
  isNicknameAvailable,
  logoutCurrentSession,
  saveProfileChanges,
  toMemberProfile,
} from './api';

const member = {
  id: 17,
  nickname: '말랑구름',
  profileImageUrl: '/uploads/profile/avatar.webp',
};
const legacyMember = {
  userId: 17,
  email: 'member@example.test',
  nickname: '말랑구름',
  profileImageUrl: '/uploads/profile/avatar.webp',
};
const csrfResponse = () => new Response(JSON.stringify({ data: { token: 'csrf-token' } }));

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('accepted Me profile adapter', () => {
  it('keeps only WePick profile fields and accepts a nullable image', () => {
    expect(toMemberProfile(member)).toEqual({
      id: '17',
      nickname: '말랑구름',
      profileImage: { kind: 'url', url: '/uploads/profile/avatar.webp' },
    });
    expect(toMemberProfile({ ...member, profileImageUrl: null }).profileImage).toEqual({
      kind: 'default',
      key: 'wepick-default',
    });
  });

  it('loads the accepted /api/me DTO for the profile screen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: member })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getMemberProfile()).resolves.toMatchObject({ id: '17', nickname: '말랑구름' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});

describe('accepted logout contract', () => {
  it('sends the refreshed CSRF token to POST /api/auth/logout', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutCurrentSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBe('csrf-token');
  });

  it('does not report a failed logout as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(csrfResponse())
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    );
    await expect(logoutCurrentSession()).rejects.toThrow('API request failed with status 503');
  });
});

describe('existing profile editing contract', () => {
  it('checks nickname availability at the supported legacy endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { isExisted: false } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { isExisted: true } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(isNicknameAvailable('새닉네임')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/users/check-nickname',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ nickname: '새닉네임' }),
      }),
    );
    await expect(isNicknameAvailable('사용중')).resolves.toBe(false);
  });

  it('patches a nickname through the supported legacy endpoint with CSRF', async () => {
    const updated = { ...legacyMember, nickname: '새닉네임' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: updated })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveProfileChanges({ nickname: '새닉네임' })).resolves.toMatchObject({
      nickname: '새닉네임',
    });
    const options = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/users/me/nickname',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ nickname: '새닉네임' }),
      }),
    );
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('uploads an image and patches only its ID through the supported legacy endpoint', async () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              imageId: 25,
              key: 'profile/avatar.png',
              url: '/uploads/profile/avatar.png',
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { ...legacyMember, profileImageUrl: '/uploads/profile/avatar.png' },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveProfileChanges({ file })).resolves.toMatchObject({
      profileImage: { url: '/uploads/profile/avatar.png' },
    });
    const uploadOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/images/profile');
    expect((uploadOptions.body as FormData).get('file')).toBe(file);
    expect(new Headers(uploadOptions.headers).has('Content-Type')).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/users/me/profile-image',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ profileImageId: 25 }) }),
    );
    expect(
      new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).get('X-CSRF-Token'),
    ).toBe('csrf-token');
  });

  it('uses the existing combined profile endpoint when changing nickname and image', async () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              imageId: 25,
              key: 'profile/avatar.png',
              url: '/uploads/profile/avatar.png',
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...legacyMember, nickname: '새닉네임' } })),
      );
    vi.stubGlobal('fetch', fetchMock);

    await saveProfileChanges({ nickname: '새닉네임', file });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/users/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ nickname: '새닉네임', profileImageId: 25 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never patches the profile when image upload fails', async () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveProfileChanges({ nickname: '새닉네임', file })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
