import type { RouteTable, RouteEntry } from "./router";
import type { AppConfig, ThinkContext } from "./types";
import { getValidateSchema } from "./decorator";
import type { ValidationSchema } from "./decorator";

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: { schemas?: Record<string, unknown> };
}

interface OpenAPIOperation {
  summary?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown }>;
  requestBody?: { content: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description: string; content?: Record<string, { schema?: unknown }> }>;
}

/** Convert a valibot schema (including piped schemas) to JSON Schema.
 *  Handles type coercion pipes (unknown→number), validation constraints,
 *  and common valibot formats (email, url, uuid, min/max length/value).
 */
export function valibotToJSONSchema(schema: ValidationSchema): unknown {
  const s = schema as unknown as Record<string, unknown>;
  const baseType = s.type as string;
  const pipe = s.pipe as Array<Record<string, unknown>> | undefined;

  let effectiveType = baseType;
  const constraints: Record<string, unknown> = {};

  if (pipe && Array.isArray(pipe)) {
    // For pipes starting with unknown, find the last schema to infer output type
    if (effectiveType === "unknown") {
      for (let i = pipe.length - 1; i >= 0; i--) {
        const item = pipe[i];
        if (item && item.kind === "schema") {
          effectiveType = item.type as string;
          break;
        }
      }
    }

    // Extract validation constraints from pipe
    for (const item of pipe) {
      if (!item || item.kind !== "validation") continue;
      const itemType = item.type as string;
      const req = item.requirement;
      switch (itemType) {
        case "email":
          constraints.format = "email";
          break;
        case "url":
          constraints.format = "uri";
          break;
        case "uuid":
          constraints.format = "uuid";
          break;
        case "min_length":
          constraints.minLength = req;
          break;
        case "max_length":
          constraints.maxLength = req;
          break;
        case "min_value":
          constraints.minimum = req;
          break;
        case "max_value":
          constraints.maximum = req;
          break;
        case "integer":
          effectiveType = "integer";
          break;
      }
    }
  }

  if (effectiveType === "string") return { type: "string", ...constraints };
  if (effectiveType === "number") return { type: "number", ...constraints };
  if (effectiveType === "integer" || effectiveType === "int") return { type: "integer", ...constraints };
  if (effectiveType === "boolean") return { type: "boolean", ...constraints };
  if (effectiveType === "date") return { type: "string", format: "date-time", ...constraints };
  if (effectiveType === "array") {
    const item = s.item as ValidationSchema | undefined;
    return { type: "array", items: item ? valibotToJSONSchema(item) : {}, ...constraints };
  }
  if (effectiveType === "object") {
    const entries = s.entries as Record<string, ValidationSchema> | undefined;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    if (entries) {
      for (const [key, val] of Object.entries(entries)) {
        properties[key] = valibotToJSONSchema(val);
        const valRec = val as unknown as Record<string, unknown>;
        const valType = valRec.type as string;
        const valPipe = valRec.pipe as Array<Record<string, unknown>> | undefined;
        const isOptional =
          valType === "optional" || (valPipe?.some((p) => p && p.type === "optional"));
        if (!isOptional) required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      ...constraints,
    };
  }
  if (effectiveType === "optional") {
    const wrapped = s.wrapped as ValidationSchema | undefined;
    return wrapped ? valibotToJSONSchema(wrapped) : {};
  }
  if (effectiveType === "union") {
    const options = s.options as ValidationSchema[] | undefined;
    return { anyOf: options?.map(valibotToJSONSchema) ?? [], ...constraints };
  }
  if (effectiveType === "unknown") return { ...constraints };
  return { ...constraints };
}

/** Extract path parameters from a route pattern like /user/:id */
function extractPathParams(pattern: string): Array<{ name: string; in: string; required: boolean; schema: unknown }> {
  const params: Array<{ name: string; in: string; required: boolean; schema: unknown }> = [];
  const regex = /:(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pattern)) !== null) {
    params.push({ name: match[1], in: "path", required: true, schema: { type: "string" } });
  }
  return params;
}

function routeToOpenAPIPath(pattern: string): string {
  return pattern.replace(/:(\w+)/g, "{$1}");
}

/** Infer HTTP method from action name (e.g. listAction → GET, createAction → POST). */
function inferMethodFromAction(action: string): string {
  if (action.startsWith("list") || action.startsWith("index") || action.startsWith("get")) return "get";
  if (action.startsWith("create") || action.startsWith("add") || action.startsWith("post")) return "post";
  if (action.startsWith("update") || action.startsWith("edit") || action.startsWith("put")) return "put";
  if (action.startsWith("delete") || action.startsWith("remove") || action.startsWith("destroy")) return "delete";
  return "post";
}

/** Infer action name from the last segment of a route pattern. */
function inferActionFromPattern(pattern: string): string {
  const parts = pattern.split("/");
  const last = parts[parts.length - 1].replace(/\.js$/, "");
  return last + "Action";
}

/** Build a single OpenAPI operation from controller class + action. */
function makeOperation(
  controllerName: string,
  action: string,
  controllerClass: unknown,
  parameters?: Array<{ name: string; in: string; required: boolean; schema: unknown }>
): OpenAPIOperation {
  const schema =
    typeof controllerClass === "function"
      ? getValidateSchema((controllerClass as { prototype: object }).prototype, action)
      : undefined;

  const operation: OpenAPIOperation = {
    summary: `${controllerName} ${action}`,
    parameters: parameters && parameters.length > 0 ? parameters : undefined,
    responses: {
      "200": {
        description: "Success",
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  };

  if (schema) {
    operation.requestBody = {
      content: { "application/json": { schema: valibotToJSONSchema(schema) } },
    };
  }

  return operation;
}

/** Add a standard (non-resource) route to the OpenAPI spec. */
function addRoute(
  paths: Record<string, Record<string, OpenAPIOperation>>,
  pattern: string,
  entry: RouteEntry,
  controllers: Record<string, unknown>
): void {
  const openPath = routeToOpenAPIPath(pattern);
  const controllerName = entry.type || "";
  const controllerClass = controllers[controllerName];
  const action = inferActionFromPattern(pattern);
  const method = inferMethodFromAction(action);
  const parameters = extractPathParams(pattern);

  if (!paths[openPath]) paths[openPath] = {};
  paths[openPath][method] = makeOperation(controllerName, action, controllerClass, parameters);
}

/** Add all REST resource routes for a single resource entry. */
function addResourceRoutes(
  paths: Record<string, Record<string, OpenAPIOperation>>,
  pattern: string,
  entry: RouteEntry,
  controllers: Record<string, unknown>
): void {
  const controllerName = entry.resource || "";
  if (!controllerName) return;
  const controllerClass = controllers[controllerName];
  const basePath = routeToOpenAPIPath(pattern).replace(/\/\*$/, "");
  const itemPath = `${basePath}/{id}`;
  const idParam = { name: "id", in: "path" as const, required: true, schema: { type: "string" } };

  if (!paths[basePath]) paths[basePath] = {};
  paths[basePath]["get"] = makeOperation(controllerName, "listAction", controllerClass);
  paths[basePath]["post"] = makeOperation(controllerName, "createAction", controllerClass);

  if (!paths[itemPath]) paths[itemPath] = {};
  paths[itemPath]["get"] = makeOperation(controllerName, "getAction", controllerClass, [idParam]);
  paths[itemPath]["put"] = makeOperation(controllerName, "updateAction", controllerClass, [idParam]);
  paths[itemPath]["delete"] = makeOperation(controllerName, "deleteAction", controllerClass, [idParam]);
}

/** Build OpenAPI spec from route table and controller classes. */
export function generateOpenAPISpec(
  routeTable: RouteTable,
  config: AppConfig,
  controllers: Record<string, unknown>
): OpenAPISpec {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {};

  for (const [pattern, entry] of routeTable.exact) {
    if (entry.type === "resource") {
      addResourceRoutes(paths, pattern, entry, controllers);
    } else {
      addRoute(paths, pattern, entry, controllers);
    }
  }
  for (const entry of routeTable.patterns) {
    if (typeof entry.match === "string") {
      if (entry.type === "resource") {
        addResourceRoutes(paths, entry.match, entry, controllers);
      } else {
        addRoute(paths, entry.match, entry, controllers);
      }
    }
  }

  const cfg = config as Record<string, unknown>;
  const openapiCfg = (cfg.openapi as Record<string, unknown>) ?? {};

  return {
    openapi: "3.0.0",
    info: {
      title: (openapiCfg.title as string) || "ThinkTS API",
      version: (openapiCfg.version as string) || "1.0.0",
    },
    paths,
  };
}

/** Create middleware that serves OpenAPI spec at /openapi.json and Swagger UI at /docs. */
export function createDocsMiddleware(spec: OpenAPISpec) {
  const specJson = JSON.stringify(spec);

  return {
    async onRequest(ctx: ThinkContext): Promise<Response | undefined> {
      if (ctx.url.pathname === "/openapi.json") {
        return new Response(specJson, {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (ctx.url.pathname === "/docs") {
        return new Response(buildSwaggerUI(), {
          headers: { "Content-Type": "text/html" },
        });
      }
    },
  };
}

function buildSwaggerUI(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}
