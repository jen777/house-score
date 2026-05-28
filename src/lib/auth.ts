// Single-user password gate. Stateless: the auth cookie holds a SHA-256 hash of
// APP_PASSWORD + AUTH_SECRET, which both the login action and middleware can
// recompute and compare. Edge-runtime compatible (Web Crypto only).

export const AUTH_COOKIE = "hs_auth";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The expected cookie token for the configured credentials. */
export async function expectedToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  return sha256Hex(`${password}:${secret}`);
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD ?? "";
  if (!password) return false;
  // Constant-time-ish compare on equal-length hashes.
  const a = await sha256Hex(candidate);
  const b = await sha256Hex(password);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedToken();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++)
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
