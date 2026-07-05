import type { ThinkContext } from "../types";

export interface StaticOptions {
  root?: string;
  publicPath?: string;
}

export function createStaticMiddleware(
  rootPath: string,
  options?: StaticOptions
): { onRequest: (ctx: ThinkContext) => Promise<Response | undefined> } {
  const assetsPath = options?.root ? `${rootPath}/${options.root}` : `${rootPath}/www/static`;
  const prefix = options?.publicPath ?? "/static";

  return {
    async onRequest(ctx: ThinkContext): Promise<Response | undefined> {
      if (!ctx.url.pathname.startsWith(prefix)) return undefined;

      const relativePath = ctx.url.pathname.slice(prefix.length).replace(/^\/+/, "");
      if (!relativePath || relativePath.includes("..")) return undefined;

      const filePath = `${assetsPath}/${relativePath}`;
      const file = Bun.file(filePath);
      if (!(await file.exists())) return undefined;

      return new Response(file);
    },
  };
}
