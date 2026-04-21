const AUTH_USER_KEY = "auth_user";

type AuthUser = {
  id?: string;
  email?: string;
  role?: string;
};

function readAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function writeAuthUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  if (!user) {
    localStorage.removeItem(AUTH_USER_KEY);
    return;
  }
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function isLoggedIn(): boolean {
  return !!readAuthUser();
}

export function setToken(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    writeAuthUser({
      id: payload.sub || undefined,
      email: payload.email || undefined,
      role: payload.role || undefined,
    });
  } catch {
    writeAuthUser(null);
  }
}

export function setAuthUser(user: { id: string; email: string; role: string }) {
  writeAuthUser({ id: user.id, email: user.email, role: user.role });
}

export function clearToken() {
  writeAuthUser(null);
}

export function getUserRole(): string | null {
  return readAuthUser()?.role || null;
}

export function getUserId(): string | null {
  return readAuthUser()?.id || null;
}

export function getUserEmail(): string | null {
  return readAuthUser()?.email || null;
}
