'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, setMemoryAccessToken, type UserSummary } from '@/lib/api/client';

interface AuthContextValue {
  user: UserSummary | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<UserSummary>;
  register: (input: { email: string; password: string; firstName: string; lastName: string; phoneNumber?: string }) => Promise<UserSummary>;
  logout: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function restoreSession() {
      try {
        const refreshedToken = await authApi.refreshWithCookie();
        if (refreshedToken && mounted) {
          const meRes = await authApi.me();
          if (mounted) setUser(meRes.data);
        }
      } catch {
        setMemoryAccessToken(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    setMemoryAccessToken(res.data.tokens.accessToken);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; firstName: string; lastName: string; phoneNumber?: string }) => {
      const res = await authApi.register(input);
      setMemoryAccessToken(res.data.tokens.accessToken);
      setUser(res.data.user);
      return res.data.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setMemoryAccessToken(null);
      setUser(null);
    }
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!user) return false;
      return user.roles.some((r) => roles.includes(r));
    },
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
