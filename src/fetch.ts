function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return new Error(obj.message);
    const text = Bun.inspect(err, { colors: false, depth: 2 });
    return new Error(text);
  }
  return new Error(String(err));
}
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface FetchResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  text: string;
}

async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function thinkFetch<T = unknown>(url: string, options: FetchOptions = {}): Promise<FetchResponse<T>> {
  const { timeout = 30000, retries = 0, retryDelay = 1000 } = options;
  const method = options.method ?? "GET";

  const init: RequestInit = { method };
  if (options.headers) init.headers = options.headers;
  if (options.body !== undefined) {
    if (
      typeof options.body === "string" ||
      options.body instanceof FormData ||
      options.body instanceof Blob ||
      options.body instanceof ArrayBuffer ||
      options.body instanceof URLSearchParams
    ) {
      init.body = options.body as never;
    } else {
      init.body = JSON.stringify(options.body);
      init.headers = { "Content-Type": "application/json", ...init.headers };
    }
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelay);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      const text = await response.text();
      let data: unknown = text;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try { data = JSON.parse(text); } catch { /* keep as text */ }
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers,
        data: data as T,
        text,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : toError(err);
      if (attempt >= retries) break;
    }
  }
  throw lastError ?? toError(`fetch failed: ${url}`);
}
