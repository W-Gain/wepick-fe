import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../shared/api/client';
import { useToast } from '../shared/ui';
import { getCurrentMember, refreshCsrfToken } from '../features/auth/api';
import { consumeLoginCompletion } from '../features/auth/loginCompletion';
import type { LoginRecovery } from '../features/auth/authFlow';
import type { LoginCompletion } from '../features/auth/loginCompletion';
import { useAuthFlow } from '../features/auth/authFlow';
import { getCurrentTopic } from '../features/pick/api';
import { toMemberProfile } from '../features/profile/api';

function getTabStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function Component() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setStatus } = useAuthFlow();
  const { notify } = useToast();
  const started = useRef(false);
  const completionRef = useRef<LoginCompletion | null | undefined>(undefined);

  useEffect(() => {
    if (started.current) return;
    completionRef.current ??= consumeLoginCompletion(
      location.search,
      getTabStorage(),
      Date.now(),
      window.location.origin,
    );
    const completionCandidate = completionRef.current;
    if (!completionCandidate) {
      started.current = true;
      notify({ tone: 'error', title: '로그인 결과를 확인할 수 없어요.' });
      navigate('/', { replace: true });
      return;
    }
    const completion: LoginCompletion = completionCandidate;

    let active = true;
    async function finish() {
      let sessionConfirmed = false;
      let member: Awaited<ReturnType<typeof getCurrentMember>> | null = null;
      try {
        member = await getCurrentMember();
      } catch (error) {
        if (!active) return;
        const unauthenticated = error instanceof ApiError && error.status === 401;
        setStatus(unauthenticated ? 'anonymous' : 'unavailable');
        if (completion.result === 'success' || !unauthenticated) {
          notify({
            tone: 'error',
            title:
              completion.result === 'success' && unauthenticated
                ? '로그인 뒤 회원 세션이 확인되지 않았어요.'
                : '로그인 상태를 확인하지 못했어요.',
            description: '연결을 확인하고 다시 시도해 주세요.',
          });
        }
      }

      if (!active) return;
      if (member) {
        setStatus('authenticated');
        queryClient.setQueryData(['member-profile'], toMemberProfile(member));
        sessionConfirmed = true;
      }

      if (sessionConfirmed && completion.result === 'success') {
        try {
          await refreshCsrfToken();
        } catch {
          if (!active) return;
          notify({
            tone: 'error',
            title: '로그인은 확인했지만 변경 요청 준비를 마치지 못했어요.',
            description: '다시 시도하면 보안 토큰을 새로 받아요.',
          });
        }
        if (!active) return;
      }

      if (sessionConfirmed && completion.result === 'success' && completion.intent.targetId) {
        const returnPath = new URL(completion.returnTo, window.location.origin).pathname;
        if (returnPath === '/') {
          try {
            const currentPick = await getCurrentTopic();
            if (!active) return;
            queryClient.setQueryData(['pick', 'today'], currentPick);
            if (
              completion.intent.action === 'write-opinion' &&
              currentPick.id !== completion.intent.targetId
            ) {
              notify({
                tone: 'info',
                title: '오늘의 Pick이 바뀌어 작성 중인 내용을 연결하지 못했어요.',
              });
            }
          } catch {
            if (!active) return;
            void queryClient.invalidateQueries({ queryKey: ['pick', 'today'], exact: true });
          }
        } else if (returnPath.startsWith('/picks/')) {
          notify({
            tone: 'info',
            title: '지난 Pick은 현재 다시 불러올 수 없어 기존 화면으로 돌아가요.',
          });
        }
      }

      if (!active) return;
      if (completion.result === 'cancelled') {
        notify({ tone: 'info', title: '로그인을 취소했어요.' });
      } else if (completion.result === 'failed') {
        notify({ tone: 'error', title: '로그인하지 못했어요. 다시 시도해 주세요.' });
      } else if (sessionConfirmed && completion.merge === 'kept_member_vote') {
        notify({ tone: 'info', title: '이전에 선택한 기록이 있어 그 선택을 유지했어요.' });
      } else if (sessionConfirmed) {
        notify({ tone: 'success', title: '로그인했어요.' });
      }

      const recovery: LoginRecovery = {
        intent: completion.intent,
        result: completion.result,
        sessionConfirmed,
        ...(completion.merge ? { merge: completion.merge } : {}),
      };
      navigate(completion.returnTo, {
        replace: true,
        state: { loginRecovery: recovery },
      });
    }

    void Promise.resolve().then(() => {
      if (!active || started.current) return;
      started.current = true;
      void finish();
    });
    return () => {
      active = false;
    };
  }, [location.search, navigate, notify, queryClient, setStatus]);

  return (
    <section className="route-status" role="status" aria-live="polite">
      <div className="route-status__content">
        <p className="route-status__eyebrow">WePick</p>
        <h1>로그인 결과를 확인하고 있어요</h1>
      </div>
    </section>
  );
}
