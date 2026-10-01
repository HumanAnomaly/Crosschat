import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMe, logout as apiLogout, type SessionUser } from "../api";

interface SessionValue {
  me: SessionUser | null;
  authLoading: boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  me: null,
  authLoading: true,
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { user } = await getMe();
        if (alive) setMe(user);
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (err) {
      console.warn("logout request failed, clearing local session anyway", err);
      return;
    } finally {
      setMe(null);
    }
  }, []);

  const value = useMemo(() => ({ me, authLoading, logout }), [me, authLoading, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
