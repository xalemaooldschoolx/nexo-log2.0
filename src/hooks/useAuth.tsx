import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { setDemoModeActive } from '../lib/api.ts';
import {
  bootstrapPresentationFromServer,
  getDemoSession,
  resetDemoSandboxState,
  switchPresentationViewMode,
} from '../lib/demo-api.ts';
import { PresentationViewMode, SessionData } from '../types/nexo.ts';

function isDirectPresentationUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const apParam = (params.get('apresentacao') || '').toLowerCase();
  const modoParam = (params.get('modo') || '').toLowerCase();
  const demoParam = (params.get('demo') || '').toLowerCase();
  return (
    path === '/apresentacao' ||
    apParam === '1' ||
    apParam === 'true' ||
    modoParam === 'apresentacao' ||
    demoParam === '1' ||
    demoParam === 'true'
  );
}

interface AuthContextValue {
  firebaseUser: User | null;
  session: SessionData | null;
  isDemoMode: boolean;
  presentationViewMode: PresentationViewMode;
  demoHydrationVersion: number;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => Promise<void>;
  resetDemoSandbox: () => void;
  switchPresentationMode: (mode: PresentationViewMode) => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialDirectPresentation] = useState<boolean>(() => {
    const active = isDirectPresentationUrl();
    if (active) {
      setDemoModeActive(true);
    }
    return active;
  });

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [session, setSession] = useState<SessionData | null>(() =>
    initialDirectPresentation ? { ...getDemoSession() } : null
  );
  const [isDemoMode, setIsDemoMode] = useState<boolean>(initialDirectPresentation);
  const [presentationViewMode, setPresentationViewMode] =
    useState<PresentationViewMode>('CENARIO_REALISTA');
  const [demoHydrationVersion, setDemoHydrationVersion] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(!initialDirectPresentation);
  const [authError, setAuthError] = useState<string | null>(null);

  const getIdToken = useCallback(async () => {
    if (isDemoMode) return null;
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  }, [isDemoMode]);

  const fetchBackendSession = useCallback(async (user: User) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/session', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao validar sessão no servidor.');
    }
    const data: SessionData = await res.json();
    setSession(data);
  }, []);

  useEffect(() => {
    if (!isDemoMode) return;
    let cancelled = false;
    void bootstrapPresentationFromServer(presentationViewMode).then((meta) => {
      if (cancelled) return;
      setPresentationViewMode(meta.viewMode);
      setSession({ ...getDemoSession() });
      setDemoHydrationVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [isDemoMode]);

  useEffect(() => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setLoading(false);
      }
    }, 4000);

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        settled = true;
        window.clearTimeout(timeoutId);
        setFirebaseUser(user);
        setAuthError(null);
        if (isDemoMode) {
          setLoading(false);
          return;
        }
        if (!user) {
          setSession(null);
          setLoading(false);
          return;
        }
        try {
          await fetchBackendSession(user);
        } catch (err: any) {
          console.error('Session sync failed:', err);
          setAuthError(err.message || 'Erro ao carregar permissões do usuário.');
          setSession(null);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        settled = true;
        window.clearTimeout(timeoutId);
        console.error('Auth listener error:', err);
        setLoading(false);
      }
    );

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchBackendSession, isDemoMode]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    setDemoModeActive(false);
    setIsDemoMode(false);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      await fetchBackendSession(cred.user);
    } catch (err: any) {
      console.error('Login error:', err);
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Autenticação cancelada antes da conclusão.');
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          'Este endereço de preview ainda não está autorizado no Firebase Auth. Use o Modo Apresentação Executiva abaixo ou adicione o domínio no Firebase Console.'
        );
      } else if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        setAuthError(
          'O navegador ou iframe bloqueou a janela de login Google. Abra o app em uma nova aba ou entre pelo Modo Apresentação Executiva.'
        );
      } else {
        setAuthError(err?.message || 'Não foi possível concluir o login.');
      }
      setLoading(false);
    }
  };

  const enterDemoMode = useCallback(() => {
    setAuthError(null);
    resetDemoSandboxState();
    setDemoModeActive(true);
    setIsDemoMode(true);
    setSession({ ...getDemoSession() });
    setLoading(false);
  }, []);

  const exitDemoMode = useCallback(async () => {
    setDemoModeActive(false);
    setIsDemoMode(false);
    setAuthError(null);
    if (typeof window !== 'undefined' && isDirectPresentationUrl()) {
      window.history.replaceState({}, '', '/');
    }
    if (auth.currentUser) {
      setLoading(true);
      try {
        await fetchBackendSession(auth.currentUser);
      } catch (err: any) {
        setAuthError(err.message || 'Erro ao restaurar sessão real.');
        setSession(null);
      } finally {
        setLoading(false);
      }
    } else {
      setSession(null);
    }
  }, [fetchBackendSession]);

  const resetDemoSandbox = useCallback(() => {
    if (!isDemoMode) return;
    resetDemoSandboxState();
    setSession({ ...getDemoSession() });
    setDemoHydrationVersion((v) => v + 1);
  }, [isDemoMode]);

  const switchPresentationMode = useCallback(
    (mode: PresentationViewMode) => {
      if (!isDemoMode) return;
      switchPresentationViewMode(mode);
      setPresentationViewMode(mode);
      setSession({ ...getDemoSession() });
      setDemoHydrationVersion((v) => v + 1);
    },
    [isDemoMode]
  );

  const logout = async () => {
    setAuthError(null);
    if (isDemoMode) {
      await exitDemoMode();
      return;
    }
    await signOut(auth);
    setSession(null);
  };

  const refreshSession = async () => {
    if (isDemoMode) {
      setSession({ ...getDemoSession() });
      return;
    }
    if (!auth.currentUser) return;
    await fetchBackendSession(auth.currentUser);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        session,
        isDemoMode,
        presentationViewMode,
        demoHydrationVersion,
        loading,
        authError,
        signInWithGoogle,
        enterDemoMode,
        exitDemoMode,
        resetDemoSandbox,
        switchPresentationMode,
        logout,
        refreshSession,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return ctx;
}
