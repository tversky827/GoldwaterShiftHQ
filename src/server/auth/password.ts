import crypto from "node:crypto";

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(pw: string, salt: Buffer, opts: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so non-existent accounts aren't detectable by timing.
    await scrypt(password, crypto.randomBytes(16), PARAMS);
    return false;
  }
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await scrypt(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  const expected = Buffer.from(hash, "base64");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Choose a less predictable password.";
  return null;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
