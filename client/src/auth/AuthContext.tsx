import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, apiPut } from './api.js';

export interface AuthUser { id: string; email: string; displayName: string; username: string | null; }

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  setUsername(username: string): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ user: AuthUser | null }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const u = await apiPost<AuthUser>('/api/auth/login', { email, password });
    setUser(u);
  }
  async function register(email: string, password: string, displayName: string) {
    const u = await apiPost<AuthUser>('/api/auth/register', { email, password, displayName });
    setUser(u);
  }
  async function logout() {
    await apiPost('/api/auth/logout', {});
    setUser(null);
  }
  async function refresh() {
    const r = await apiGet<{ user: AuthUser | null }>('/api/auth/me');
    setUser(r.user);
  }
  async function setUsername(username: string) {
    await apiPut('/api/account/username', { username });
    await refresh();
  }

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, setUsername, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
