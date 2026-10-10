import { createContext, useContext } from 'react';

export type AuthStatus = 'unknown' | 'unavailable' | 'anonymous' | 'authenticated';
export type LoginIntent = {
  action: 'write-opinion' | 'like-opinion' | 'delete-opinion' | 'view-history' | 'view-profile';
  returnTo: string;
  targetId?: string;
  draft?: string;
};

export type LoginRecovery = {
  intent: LoginIntent;
  result: 'success' | 'cancelled' | 'failed';
  sessionConfirmed: boolean;
  merge?: 'kept_member_vote';
};

export type AuthFlowContextValue = {
  status: AuthStatus;
  pendingIntent: LoginIntent | null;
  setStatus: (status: AuthStatus) => void;
  retrySession: () => void;
  beginLogin: (intent: LoginIntent) => void;
  consumeLoginIntent: () => LoginIntent | null;
  cancelLogin: () => void;
};

export const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);

export function useAuthFlow() {
  const context = useContext(AuthFlowContext);
  if (!context) throw new Error('useAuthFlow must be used inside AuthFlowProvider.');
  return context;
}
