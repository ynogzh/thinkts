import type { ThinkContext, Middleware } from "../types";

async function getGraphQLModule(): Promise<Record<string, unknown>> {
  const mod = await import("graphql" as string);
  return mod as Record<string, unknown>;
}

export interface GraphQLConfig {
  schema?: unknown;
  rootValue?: Record<string, unknown>;
  context?: (ctx: ThinkContext) => Record<string, unknown>;
  graphiql?: boolean;
  playground?: boolean;
  introspection?: boolean;
}

export function createGraphQLMiddleware(config?: GraphQLConfig): Middleware {
  const schema = config?.schema;
  const rootValue = config?.rootValue ?? {};
  const buildContext = config?.context ?? ((ctx: ThinkContext) => ({ ctx }));
  const enableGraphiQL = config?.graphiql ?? config?.playground ?? false;

  return {
    async onRequest(ctx: ThinkContext): Promise<Response | void> {
      const isGraphQLPath = ctx.url.pathname === "/graphql" || ctx.url.pathname.endsWith("/graphql");
      if (!isGraphQLPath) return;

      if (!schema) {
        return new Response(
          JSON.stringify({ errno: 500, errmsg: "GraphQL schema not configured" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // GraphiQL / Playground
      if (ctx.request.method === "GET" && enableGraphiQL) {
        const html = buildGraphiQLPage(ctx.url.pathname);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      if (ctx.request.method !== "POST" && ctx.request.method !== "GET") {
        return new Response(
          JSON.stringify({ errno: 405, errmsg: "Method not allowed" }),
          { status: 405, headers: { "Content-Type": "application/json" } }
        );
      }

      let query = "";
      let variables: Record<string, unknown> | undefined;
      let operationName: string | undefined;

      if (ctx.request.method === "GET") {
        query = ctx.url.searchParams.get("query") ?? "";
        const varsParam = ctx.url.searchParams.get("variables");
        if (varsParam) {
          try { variables = JSON.parse(varsParam) as Record<string, unknown>; } catch { /* ignore */ }
        }
        operationName = ctx.url.searchParams.get("operationName") ?? undefined;
      } else {
        const body = ctx.body as Record<string, unknown> | undefined;
        if (body) {
          query = String(body.query ?? "");
          if (typeof body.variables === "object" && body.variables !== null) {
            variables = body.variables as Record<string, unknown>;
          }
          operationName = typeof body.operationName === "string" ? body.operationName : undefined;
        }
      }

      if (!query) {
        return new Response(
          JSON.stringify({ errno: 400, errmsg: "Must provide query string." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        const graphql = (await getGraphQLModule()).graphql as (args: Record<string, unknown>) => Promise<unknown>;
        const result = await graphql({
          schema: schema as never,
          source: query,
          rootValue,
          contextValue: buildContext(ctx),
          variableValues: variables,
          operationName,
        });
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            errors: [{ message: err instanceof Error ? err.message : String(err) }],
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    },
  };
}

function buildGraphiQLPage(endpoint: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GraphiQL</title>
  <style>body{margin:0;padding:0;font-family:sans-serif;}</style>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
</head>
<body style="margin:0;">
  <div id="graphiql" style="height:100vh;"></div>
  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '${endpoint}' });
    ReactDOM.render(React.createElement(GraphiQL, { fetcher }), document.getElementById('graphiql'));
  </script>
</body>
</html>`;
}

export async function loadSchemaFromFiles(rootPath: string, pattern?: string): Promise<unknown> {
  const glob = pattern ?? "src/graphql/**/*.gql";
  const buildSchema = (await getGraphQLModule()).buildSchema as (schema: string) => unknown;
  let schemaString = "";
  const files = await Array.fromAsync(
    new Bun.Glob(glob).scan({ cwd: rootPath, absolute: true })
  );
  for (const file of files.sort()) {
    schemaString += await Bun.file(file).text() + "\n";
  }
  return buildSchema(schemaString);
}
