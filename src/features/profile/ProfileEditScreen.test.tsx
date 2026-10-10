import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../../mocks/handlers';
import { memberProfile } from '../../mocks/fixtures';
import { ToastProvider } from '../../shared/ui';
import { AuthFlowProvider } from '../auth/AuthFlowProvider';
import { ProfileEditScreen } from './ProfileEditScreen';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/profile/edit']}>
      <QueryClientProvider client={client}>
        <AuthFlowProvider initialStatus="authenticated">
          <ToastProvider>
            <Routes>
              <Route path="/profile/edit" element={<ProfileEditScreen />} />
              <Route path="/profile" element={<div>프로필 화면</div>} />
            </Routes>
          </ToastProvider>
        </AuthFlowProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

describe('ProfileEditScreen', () => {
  it('validates the nickname and moves only after saving a valid change', async () => {
    server.use(
      http.get('*/api/me', () =>
        HttpResponse.json({
          data: { id: 7, nickname: memberProfile.nickname, profileImageUrl: null },
        }),
      ),
    );
    const user = userEvent.setup();
    const client = renderScreen();
    const nickname = await screen.findByRole('textbox', { name: '닉네임' });
    const save = screen.getByRole('button', { name: '변경사항 저장' });
    expect(save).toBeDisabled();

    await user.clear(nickname);
    expect(screen.getByText('닉네임은 공백 없이 1~30자로 입력해 주세요.')).toBeInTheDocument();
    await user.type(nickname, '새 닉네임');
    expect(save).toBeDisabled();

    await user.clear(nickname);
    await user.type(nickname, '새닉네임');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(await screen.findByText('프로필 화면')).toBeInTheDocument();
    expect(client.getQueryData(['member-profile'])).toMatchObject({
      id: '7',
      nickname: '새닉네임',
    });
  });
});
