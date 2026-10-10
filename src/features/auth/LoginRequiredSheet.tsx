import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

import { Button, CloseIcon, useToast } from '../../shared/ui';
import { type LoginIntent, useAuthFlow } from './authFlow';
import { startKakaoLogin } from './loginStart';

type LoginRequiredSheetProps = {
  open: boolean;
  actionLabel: string;
  intent: LoginIntent;
  onOpenChange: (open: boolean) => void;
};

type OpenLoginRequiredSheetProps = Omit<LoginRequiredSheetProps, 'open'>;

function OpenLoginRequiredSheet({
  actionLabel,
  intent,
  onOpenChange,
}: OpenLoginRequiredSheetProps) {
  const { clear, setSuspended } = useToast();
  const { beginLogin, cancelLogin } = useAuthFlow();
  const [loginState, setLoginState] = useState<'idle' | 'preparing' | 'error'>('idle');
  const activeLoginRef = useRef<AbortController | null>(null);

  useEffect(() => {
    clear();
    setSuspended(true);
    return () => {
      activeLoginRef.current?.abort();
      setSuspended(false);
    };
  }, [clear, setSuspended]);

  // 로그인 준비가 끝나기 전에 시트를 닫으면 대기 중인 준비 요청을 취소해 늦은 페이지 이동을 막는다.
  function cancelLoginStart() {
    activeLoginRef.current?.abort();
    activeLoginRef.current = null;
    cancelLogin();
    setLoginState('idle');
  }

  async function startLogin() {
    if (activeLoginRef.current || loginState === 'preparing') return;
    const controller = new AbortController();
    activeLoginRef.current = controller;
    beginLogin(intent);
    setLoginState('preparing');

    try {
      await startKakaoLogin(intent, controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        cancelLogin();
        setLoginState('error');
      }
    } finally {
      if (activeLoginRef.current === controller) activeLoginRef.current = null;
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) cancelLoginStart();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root open onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="sheet-content" aria-describedby="login-required-description">
          <div className="sheet-content__handle" aria-hidden="true" />
          <header className="sheet-content__header">
            <div className="sheet-content__header-copy">
              <Dialog.Title>로그인이 필요해요</Dialog.Title>
              <Dialog.Description id="login-required-description">
                <span className="sheet-content__description-line">
                  {`${actionLabel}은 로그인 후 이용할 수 있어요.`}
                </span>
                <span className="sheet-content__description-line">
                  로그인하면 지금 화면으로 돌아와요.
                </span>
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="닫기">
              <CloseIcon />
            </Dialog.Close>
          </header>
          <Button disabled={loginState === 'preparing'} onClick={startLogin}>
            {loginState === 'preparing'
              ? '로그인 준비 중…'
              : loginState === 'error'
                ? '다시 시도'
                : '카카오로 계속하기'}
          </Button>
          {loginState === 'error' && (
            <p className="opinion-editor__error" role="alert">
              로그인을 준비하지 못했어요. 연결을 확인하고 다시 시도해 주세요.
            </p>
          )}
          <Dialog.Close asChild>
            <Button variant="ghost">취소</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function LoginRequiredSheet({ open, ...props }: LoginRequiredSheetProps) {
  return open ? <OpenLoginRequiredSheet {...props} /> : null;
}
