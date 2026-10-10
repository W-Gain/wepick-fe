import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../../shared/ui';
import { AuthFlowProvider } from './AuthFlowProvider';
import { LoginRequiredSheet } from './LoginRequiredSheet';
import { startKakaoLogin } from './loginStart';

vi.mock('./loginStart', () => ({ startKakaoLogin: vi.fn() }));

const mockedStartKakaoLogin = vi.mocked(startKakaoLogin);

afterEach(() => mockedStartKakaoLogin.mockReset());

function renderLoginSheet(onOpenChange = vi.fn()) {
  return render(
    <AuthFlowProvider>
      <ToastProvider>
        <LoginRequiredSheet
          open
          actionLabel="의견 남기기"
          intent={{ action: 'write-opinion', returnTo: '/picks/12', targetId: '12' }}
          onOpenChange={onOpenChange}
        />
      </ToastProvider>
    </AuthFlowProvider>,
  );
}

describe('LoginRequiredSheet', () => {
  it('연속 클릭해도 로그인 시작은 한 번만 호출한다', () => {
    mockedStartKakaoLogin.mockResolvedValue('76e4a987-54c9-45ce-8b16-d2ceeb89fa31');
    renderLoginSheet();
    const button = screen.getByRole('button', { name: '카카오로 계속하기' });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(mockedStartKakaoLogin).toHaveBeenCalledOnce();
  });

  it('준비 실패를 안내하고 다시 시도를 허용한다', async () => {
    const user = userEvent.setup();
    mockedStartKakaoLogin.mockRejectedValueOnce(new Error('prepare failed'));
    mockedStartKakaoLogin.mockResolvedValueOnce('76e4a987-54c9-45ce-8b16-d2ceeb89fa31');
    renderLoginSheet();

    await user.click(screen.getByRole('button', { name: '카카오로 계속하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인을 준비하지 못했어요');
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry).toBeEnabled();

    await user.click(retry);
    await waitFor(() => expect(mockedStartKakaoLogin).toHaveBeenCalledTimes(2));
  });

  it('준비 중 닫으면 대기 중 요청을 취소한다', async () => {
    const user = userEvent.setup();
    let observedSignal: AbortSignal | undefined;
    mockedStartKakaoLogin.mockImplementation((_intent, signal) => {
      observedSignal = signal;
      return new Promise(() => {});
    });
    const onOpenChange = vi.fn();
    renderLoginSheet(onOpenChange);

    await user.click(screen.getByRole('button', { name: '카카오로 계속하기' }));
    await waitFor(() => expect(observedSignal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(observedSignal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
