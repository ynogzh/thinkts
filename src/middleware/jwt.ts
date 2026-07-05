import { AuthError } from "../error";
import type { ThinkContext } from "../types";
import { normalizePath } from "../router/handler";

export interface JWTOptions {
  secret: string;
  algorithm?: string;
  ignore?: (string | RegExp)[];
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return atob(padded);
}

async function importKey(secret: string, alg: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    data,
    { name: "HMAC", hash: alg === "HS512" ? "SHA-512" : alg === "HS384" ? "SHA-384" : "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifyJWT(token: string, key: CryptoKey): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [headerB64, payloadB64, signatureB64] = parts;
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as Record<string, unknown>;

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify("HMAC", key, signature, data);
  if (!valid) throw new Error("Invalid JWT signature");

  const CLOCK_SKEW = 5; // 5 seconds tolerance for clock skew
  const exp = payload.exp;
  if (typeof exp === "number" && Date.now() / 1000 > exp + CLOCK_SKEW) {
    throw new Error("JWT expired");
  }
  const nbf = payload.nbf;
  if (typeof nbf === "number" && Date.now() / 1000 < nbf - CLOCK_SKEW) {
    throw new Error("JWT not active");
  }
  const iat = payload.iat;
  if (typeof iat === "number" && Date.now() / 1000 < iat - CLOCK_SKEW) {
    throw new Error("JWT issued in the future");
  }
  return payload;
}

function shouldIgnore(pathname: string, ignoreList: (string | RegExp)[]): boolean {
  const normalized = normalizePath(pathname);
  for (const pattern of ignoreList) {
    if (typeof pattern === "string") {
      if (normalized === pattern || normalized.startsWith(pattern + "/")) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(normalized)) return true;
    }
  }
  return false;
}

export function createJWTMiddleware(
  options: JWTOptions
): { onRequest: (ctx: ThinkContext) => Promise<Response | void>; ready: Promise<void> } {
  const { secret, algorithm = "HS256", ignore = [] } = options;
  let key: CryptoKey;
  const ready = importKey(secret, algorithm).then((k) => { key = k; });

  return {
    ready,
    async onRequest(ctx: ThinkContext): Promise<Response | void> {
      const normalizedPath = normalizePath(ctx.url.pathname);
      if (shouldIgnore(normalizedPath, ignore)) return;

      const auth = ctx.request.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ")) {
        throw new AuthError("Missing Bearer token", { traceId: ctx.traceId, status: 401 });
      }

      const token = auth.slice(7).trim();
      try {
        ctx.jwt = await verifyJWT(token, key);
        ctx.user = ctx.jwt;
      } catch (err) {
        throw new AuthError(err instanceof Error ? err.message : "Invalid token", { traceId: ctx.traceId, status: 401 });
      }
    },
  };
}

export { verifyJWT };
