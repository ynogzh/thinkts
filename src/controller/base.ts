import type { ThinkContext } from "../types";
import type { Schema, ValidationResult } from "../validate";
import type { BaseIssue } from "valibot";
import type { Model } from "../model";
import type { UploadOptions } from "../upload";
import { parseUpload } from "../upload";
import { thinkCache, thinkCacheJSON } from "../cache";
import { validate as runValidate, safeValidate as runSafeValidate, formatValidationErrors } from "../validate";
import { ValidationError } from "../error";
export class ControllerBase {
  ctx: ThinkContext;

  constructor(ctx: ThinkContext) {
    this.ctx = ctx;
  }

  get body(): unknown {
    return this.ctx.set.status;
  }

  set body(value: unknown) {
    if (typeof value === "number") {
      this.ctx.set.status = value;
    } else {
      this.ctx.set.status = 200;
    }
  }

  get status(): number {
    return this.ctx.set.status ?? 200;
  }

  set status(code: number) {
    this.ctx.set.status = code;
  }

  get ip(): string | null {
    const info = this.ctx.server.requestIP(this.ctx.request);
    return info?.address ?? null;
  }

  get method(): string {
    return this.ctx.request.method;
  }

  get isGet(): boolean {
    return this.ctx.request.method === "GET";
  }

  get isPost(): boolean {
    return this.ctx.request.method === "POST";
  }

  get isAjax(): boolean {
    const header = this.ctx.request.headers.get("x-requested-with");
    return header === "XMLHttpRequest";
  }

  isJsonp(callbackField = "callback"): boolean {
    return this.ctx.url.searchParams.has(callbackField);
  }

  get(name: string, defaultValue?: string): string | undefined {
    const value = this.ctx.url.searchParams.get(name);
    return value ?? defaultValue;
  }

  post(name?: string): unknown {
    const body = this.ctx.body;
    if (name === undefined) return body;
    if (body && typeof body === "object" && name in body) {
      return (body as Record<string, unknown>)[name];
    }
    return undefined;
  }

  file(name?: string): unknown {
    const body = this.ctx.body;
    if (name === undefined) return body;
    if (body && typeof body === "object" && name in body) {
      const val = (body as Record<string, unknown>)[name];
      if (val instanceof Blob || val instanceof File) return val;
    }
    return undefined;
  }

  files(name?: string): unknown {
    if (name === undefined) return this.ctx.uploadFiles;
    return this.ctx.uploadFiles?.[name];
  }

  async upload(options?: Record<string, unknown>): Promise<{ fields: Record<string, unknown>; files: Record<string, unknown> }> {
    const result = await parseUpload(this.ctx.request, options as UploadOptions);
    this.ctx.uploadFiles = result.files;
    return result as { fields: Record<string, unknown>; files: Record<string, unknown> };
  }

  header(name: string): string | null;
  header(name: string, value: string): void;
  header(name: Record<string, string>): void;
  header(
    name: string | Record<string, string>,
    value?: string
  ): string | null | void {
    if (typeof name === "string" && value === undefined) {
      return this.ctx.request.headers.get(name);
    }
    if (typeof name === "string" && value !== undefined) {
      this.ctx.set.headers[name] = value;
      return;
    }
    if (typeof name === "object") {
      for (const [k, v] of Object.entries(name)) {
        this.ctx.set.headers[k] = v;
      }
    }
  }

  cookie(name: string): string | undefined;
  cookie(name: string, value: string, options?: Record<string, unknown>): void;
  cookie(
    name: string,
    value?: string,
    options?: Record<string, unknown>
  ): string | undefined | void {
    if (value === undefined) {
      const c = this.ctx.cookie[name];
      return typeof c === "string" ? c : undefined;
    }
    const opts = options ?? {};
    const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${String(opts.maxAge)}`);
    if (opts.expires instanceof Date) parts.push(`Expires=${opts.expires.toUTCString()}`);
    if (opts.path !== undefined) parts.push(`Path=${String(opts.path)}`);
    if (opts.domain !== undefined) parts.push(`Domain=${String(opts.domain)}`);
    if (opts.secure === true) parts.push("Secure");
    if (opts.httpOnly === true) parts.push("HttpOnly");
    if (opts.sameSite !== undefined) parts.push(`SameSite=${String(opts.sameSite)}`);
    this.ctx.set.headers["Set-Cookie"] = parts.join("; ");
  }

  session(name: string): unknown;
  session(name: string, value: unknown): void;
  session(name: string, value?: unknown): unknown | void {
    if (value === undefined) {
      return this.ctx.session?.[name];
    }
    if (!this.ctx.session) this.ctx.session = {};
    this.ctx.session[name] = value;
  }

  redirect(url: string, status = 302): void {
    this.ctx.set.headers["Location"] = url;
    this.ctx.set.status = status;
  }

  json(data: unknown): unknown {
    this.ctx.set.headers["Content-Type"] = "application/json";
    return data;
  }

  jsonp(data: unknown, callbackField = "callback"): unknown {
    const callback = this.ctx.url.searchParams.get(callbackField) ?? "callback";
    this.ctx.set.headers["Content-Type"] = "application/javascript";
    return `${callback}(${JSON.stringify(data)})`;
  }

  success(data?: unknown, message?: string): Record<string, unknown> {
    const result: Record<string, unknown> = { errno: 0 };
    if (data !== undefined) result.data = data;
    if (message !== undefined) result.errmsg = message;
    this.json(result);
    return result;
  }

  fail(
    errno: number,
    errmsg?: string,
    data?: unknown
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { errno };
    if (errmsg !== undefined) result.errmsg = errmsg;
    if (data !== undefined) result.data = data;
    this.json(result);
    return result;
  }

  expires(time: number): void {
    const date = new Date(Date.now() + time * 1000);
    this.ctx.set.headers["Expires"] = date.toUTCString();
    this.ctx.set.headers["Cache-Control"] = `max-age=${time}`;
  }

  referrer(onlyHost = false): string | null {
    const ref = this.ctx.request.headers.get("referer");
    if (!ref) return null;
    if (onlyHost) {
      try {
        return new URL(ref).host;
      } catch {
        return null;
      }
    }
    return ref;
  }

  userAgent(): string | null {
    return this.ctx.request.headers.get("user-agent");
  }

  type(contentType?: string): string | null | void {
    if (contentType === undefined) {
      const val = this.ctx.set.headers["Content-Type"];
      return typeof val === "string" ? val : null;
    }
    this.ctx.set.headers["Content-Type"] = contentType;
  }

  download(filepath: string, filename?: string): Response {
    const file = Bun.file(filepath);
    const headers: Record<string, string> = {
      "Content-Disposition": `attachment; filename="${filename ?? filepath}"`,
    };
    return new Response(file, { headers });
  }

  async display(templatePath: string): Promise<Response> {
    const rootPath = this.ctx.think?.ROOT_PATH ?? ".";
    const viewPath = `${rootPath}/view/${templatePath}.html`;
    const file = Bun.file(viewPath);
    if (!(await file.exists())) {
      this.ctx.set.status = 500;
      return new Response(`Template not found: ${viewPath}`, { status: 500 });
    }
    const content = await file.text();
    this.ctx.set.headers["Content-Type"] = "text/html; charset=utf-8";
    return new Response(content);
  }

  /** Resolve the model name: explicit name or derive from controller path.
   *  Replace `/` separators with `_` for table names (e.g. `iotbiz/device` → `iotbiz_device`). */
  model<T = Record<string, unknown>>(name?: string, config?: Record<string, unknown>): Model<T> {
    const think = this.ctx.think;
    const resolvedName = name ?? (this.ctx.controller ?? "index").replace(/\//g, "_");
    const modelConfig = think?.config("model", {}) as Record<string, unknown>;
    const m = think!.model(resolvedName, { ...modelConfig, ...config, _aclCtx: this.ctx });
    return m as Model<T>;
  }

  /** Same as model() but reuses the existing DB connection for transactions. */
  transModel<T = Record<string, unknown>>(name?: string, config?: Record<string, unknown>): Model<T> {
    const think = this.ctx.think;
    const resolvedName = name ?? (this.ctx.controller ?? "index").replace(/\//g, "_");
    const modelConfig = think?.config("model", {}) as Record<string, unknown>;
    return think!.transModel(resolvedName, { ...modelConfig, ...config, _aclCtx: this.ctx }) as Model<T>;
  }

  cache(name: string, value?: unknown, config?: Record<string, unknown>): Promise<unknown> {
    const think = this.ctx.think;
    const cacheConfig = think?.config("cache", {}) as Record<string, unknown>;
    return thinkCache(name, value, { ...cacheConfig, ...config });
  }

  cacheJSON<T = unknown>(name: string, value?: T, config?: Record<string, unknown>): Promise<T | undefined> {
    const think = this.ctx.think;
    const cacheConfig = think?.config("cache", {}) as Record<string, unknown>;
    return thinkCacheJSON(name, value, { ...cacheConfig, ...config });
  }

  validate<T>(schema: Schema, data?: unknown): T {
    const input = data ?? this.ctx.body;
    try {
      return runValidate(schema, input) as T;
    } catch (err) {
      if (err && typeof err === "object" && "issues" in err) {
        const msg = formatValidationErrors((err as { issues: readonly BaseIssue<unknown>[] }).issues);
        throw new ValidationError(msg, { traceId: this.ctx.traceId });
      }
      throw err;
    }
  }

  safeValidate<T>(schema: Schema, data?: unknown): ValidationResult<T> {
    const input = data ?? this.ctx.body;
    return runSafeValidate(schema, input) as ValidationResult<T>;
  }
}
