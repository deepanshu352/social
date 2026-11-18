import crypto from "node:crypto";

/**
 * Security primitives (BRD §8, §99).
 *  - AES-256-GCM field encryption for secrets at rest (TOTP seeds, webhook secrets, provider credentials)
 *  - password policy
 *  - IP allowlist matching (exact IPv4/IPv6 or IPv4 CIDR)
 *  - phone masking for roles without `data.unmask`
 */
function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && /^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  // Dev fallback: derive from AUTH_SECRET. Set a dedicated 32-byte ENCRYPTION_KEY in production.
  return crypto.createHash("sha256").update(`enc:${process.env.AUTH_SECRET ?? "dev"}`).digest();
}

const PREFIX = "enc:v1:";

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext — re-encrypted on next write
  const buf = Buffer.from(value.slice(PREFIX.length), "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "qwerty123", "iloveyou", "admin123", "welcome123", "india123", "abc12345", "11111111", "passw0rd"]);

export function passwordProblems(pw: string, email?: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  if (COMMON.has(pw.toLowerCase())) return "This password is too common.";
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Don't include your email name in the password.";
  return null;
}

function ipv4ToInt(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function ipAllowed(ip: string | null, allowlist: string[]) {
  if (!allowlist.length) return true;
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  return allowlist.some((rule) => {
    const r = rule.trim();
    if (!r) return false;
    if (!r.includes("/")) return r === clean;
    const [base, bitsStr] = r.split("/");
    const bits = Number(bitsStr), a = ipv4ToInt(clean), b = ipv4ToInt(base);
    if (a == null || b == null || isNaN(bits)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return phone ?? null;
  if (phone.length < 8) return "••••";
  return phone.slice(0, 5) + "•".repeat(Math.max(3, phone.length - 8)) + phone.slice(-3);
}

export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
