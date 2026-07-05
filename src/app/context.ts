export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return new Error(obj.message);
    const text = Bun.inspect(err, { colors: false, depth: 2 });
    return new Error(text);
  }
  return new Error(String(err));
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = header.split(";");
  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split("=");
    if (name && valueParts.length > 0) {
      result[name] = decodeURIComponent(valueParts.join("="));
    }
  }
  return result;
}

export async function parseBody(request: Request, maxBodySize: number): Promise<unknown> {
  const method = request.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return undefined;
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > maxBodySize) {
      throw new Error(`Request body too large (max ${String(maxBodySize)} bytes)`);
    }
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const text = await request.text();
      return Object.fromEntries(new URLSearchParams(text));
    } catch {
      return undefined;
    }
  }
  if (contentType.includes("multipart/form-data")) {
    return undefined;
  }
  try {
    return await request.text();
  } catch {
    return undefined;
  }
}

export function matchesRoute(pathname: string, match: RegExp | string): boolean {
  if (typeof match === "string") {
    if (match.startsWith("/")) {
      return pathname === match || pathname.startsWith(match + "/");
    }
    return new RegExp(match).test(pathname);
  }
  return match.test(pathname);
}
