// Edge-safe JWT helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "bos_session";
export const MFA_COOKIE = "bos_mfa";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-change-me-0123456789abcdef");

export async function signToken(payload: Record<string, unknown>, expiresIn: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(secret());
}

export async function verifyToken<T = Record<string, unknown>>(token?: string | null): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}
