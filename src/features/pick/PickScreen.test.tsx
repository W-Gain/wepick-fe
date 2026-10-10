import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { todayPickAfterVote, todayPickBeforeVote } from '../../mocks/fixtures';
import { handlers } from '../../mocks/handlers';
import { ToastProvider } from '../../shared/ui';
import { AuthFlowProvider } from '../auth/AuthFlowProvider';
import { PickScreen } from './PickScreen';

const server = setupServer(...handlers);

function LocationStateProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-state">{location.state === null ? 'cleared' : 'present'}</output>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function renderScreen(state: unknown = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <LocationStateProbe />
      <QueryClientProvider client={client}>
        <AuthFlowProvider initialStatus="authenticated">
          <ToastProvider>
            <PickScreen />
          </ToastProvider>
        </AuthFlowProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PickScreen', () => {
  it('hides results before voting and enables submission after selecting', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: todayPickBeforeVote.question }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '투표 결과' })).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: '투표하기' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /A\s*꼼꼼하게 계획대로/ }));
    expect(submit).toBeEnabled();
  });

  it('shows the result and opinions after a successful vote', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickBeforeVote)),
      http.post('*/api/__mock/picks/:pickId/votes', () => HttpResponse.json(todayPickAfterVote)),
    );
    renderScreen();

    await screen.findByRole('heading', { name: todayPickBeforeVote.question });
    await user.click(screen.getByRole('button', { name: /A\s*꼼꼼하게 계획대로/ }));
    await user.click(screen.getByRole('button', { name: '투표하기' }));

    expect(await screen.findByRole('heading', { name: '투표 결과' })).toBeInTheDocument();
    expect(screen.getAllByText('계획이 있으면 여행지에서 마음이 더 편해요.')).toHaveLength(2);
  });

  it('opens the opinion editor with the existing opinion in edit mode', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen();

    await screen.findByRole('heading', { name: todayPickAfterVote.question });
    await user.click(screen.getByRole('button', { name: '내 의견 수정' }));

    expect(screen.getByRole('dialog', { name: '의견 수정' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '선택한 이유를 남겨주세요' })).toHaveValue(
      '계획이 있으면 여행지에서 마음이 더 편해요.',
    );
    expect(screen.getByText('24 / 300')).toBeInTheDocument();
  });

  it('로그인 후 같은 Pick으로 돌아오면 의견 초안을 복구하되 자동 등록하지 않는다', async () => {
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen({
      loginRecovery: {
        intent: {
          action: 'write-opinion',
          returnTo: '/',
          targetId: todayPickAfterVote.id,
          draft: '로그인 전 작성한 의견',
        },
        result: 'success',
        sessionConfirmed: true,
      },
    });

    expect(await screen.findByRole('dialog', { name: '의견 남기기' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '선택한 이유를 남겨주세요' })).toHaveValue(
      '로그인 전 작성한 의견',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('로그인 복귀 화면에서 300 emoji 의견 초안을 그대로 복원한다', async () => {
    const draft = '😀'.repeat(300);
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen({
      loginRecovery: {
        intent: {
          action: 'write-opinion',
          returnTo: '/',
          targetId: todayPickAfterVote.id,
          draft,
        },
        result: 'success',
        sessionConfirmed: true,
      },
    });

    expect(await screen.findByRole('dialog', { name: '의견 남기기' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '선택한 이유를 남겨주세요' })).toHaveValue(draft);
    expect([...draft]).toHaveLength(300);
    expect(screen.getByText('300 / 300')).toBeInTheDocument();
  });

  it('오늘의 Pick이 달라져 의견 편집을 복구할 수 없어도 초안은 화면에 남긴다', async () => {
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen({
      loginRecovery: {
        intent: {
          action: 'write-opinion',
          returnTo: '/',
          targetId: 'previous-pick',
          draft: '다른 Pick에서 작성한 의견 초안',
        },
        result: 'success',
        sessionConfirmed: true,
      },
    });

    expect(await screen.findByText('cleared')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '로그인 후 복구한 의견 초안' })).toHaveValue(
      '다른 Pick에서 작성한 의견 초안',
    );
  });

  it.each(['like-opinion', 'delete-opinion'] as const)(
    '%s 복귀는 세션이 확인되지 않으면 로그인 성공 안내를 보이지 않는다',
    async (action) => {
      server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
      renderScreen({
        loginRecovery: {
          intent: { action, returnTo: '/' },
          result: 'success',
          sessionConfirmed: false,
        },
      });

      expect(await screen.findByText('cleared')).toBeInTheDocument();
      expect(
        screen.queryByText('로그인했어요. 원래 하려던 작업은 다시 선택해 주세요.'),
      ).not.toBeInTheDocument();
    },
  );

  it('like 복귀는 success 결과와 확인된 세션이 모두 있을 때만 재선택 안내를 보인다', async () => {
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen({
      loginRecovery: {
        intent: { action: 'like-opinion', returnTo: '/' },
        result: 'success',
        sessionConfirmed: true,
      },
    });

    expect(
      await screen.findByText('로그인했어요. 원래 하려던 작업은 다시 선택해 주세요.'),
    ).toBeInTheDocument();
  });

  it.each(['cancelled', 'failed'] as const)(
    '%s like 복귀는 로그인 성공 안내를 보이지 않는다',
    async (result) => {
      server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
      renderScreen({
        loginRecovery: {
          intent: { action: 'like-opinion', returnTo: '/' },
          result,
          sessionConfirmed: false,
        },
      });

      expect(await screen.findByText('cleared')).toBeInTheDocument();
      expect(
        screen.queryByText('로그인했어요. 원래 하려던 작업은 다시 선택해 주세요.'),
      ).not.toBeInTheDocument();
    },
  );

  it('인증되지 않은 failed 복귀에서도 의견 초안은 복원한다', async () => {
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen({
      loginRecovery: {
        intent: {
          action: 'write-opinion',
          returnTo: '/',
          targetId: todayPickAfterVote.id,
          draft: '실패 후에도 보존할 의견 초안',
        },
        result: 'failed',
        sessionConfirmed: false,
      },
    });

    expect(await screen.findByRole('dialog', { name: '의견 남기기' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '선택한 이유를 남겨주세요' })).toHaveValue(
      '실패 후에도 보존할 의견 초안',
    );
    expect(screen.queryByText('로그인했어요.')).not.toBeInTheDocument();
  });

  it('asks for confirmation before deleting my opinion', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/__mock/picks/today', () => HttpResponse.json(todayPickAfterVote)));
    renderScreen();

    await screen.findByRole('heading', { name: todayPickAfterVote.question });
    const deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    expect(deleteButtons.length).toBeGreaterThan(0);
    await user.click(deleteButtons[0]!);

    const dialog = screen.getByRole('alertdialog', { name: '의견을 삭제할까요?' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/삭제한 의견은 복구할 수 없어요/)).toBeInTheDocument();
    expect(screen.getByText(/투표 기록은 그대로 유지돼요/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getAllByText('계획이 있으면 여행지에서 마음이 더 편해요.')).toHaveLength(2);
  });

  it('does not describe unsupported opinion data as an empty opinion list', async () => {
    server.use(
      http.get('*/api/__mock/picks/today', () =>
        HttpResponse.json({
          ...todayPickAfterVote,
          opinionsAvailable: false,
          representativeOpinions: { A: null, B: null },
        }),
      ),
    );
    renderScreen();

    expect(await screen.findByText('의견 기능은 준비 중이에요')).toBeInTheDocument();
    expect(screen.queryByText('아직 의견이 없어요')).not.toBeInTheDocument();
  });

  it('shows the unavailable state when there is no topic for today', async () => {
    server.use(http.get('*/api/__mock/picks/today', () => new HttpResponse(null, { status: 404 })));
    renderScreen();

    expect(await screen.findByText('오늘의 Pick을 준비하고 있어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('does not claim a link was copied when clipboard access fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard denied'));
    renderScreen();

    await screen.findByRole('heading', { name: todayPickBeforeVote.question });
    await user.click(screen.getByRole('button', { name: 'Pick 공유' }));

    expect(await screen.findByText('링크를 복사하지 못했어요.')).toBeInTheDocument();
    expect(screen.queryByText('링크를 복사했어요.')).not.toBeInTheDocument();
  });
});
