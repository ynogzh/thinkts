import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";
export type {
  DslAppData,
  DslModelEntry,
  DslServiceEntry,
  DslApiEntry,
  DslTableEntry,
  DslAclEntry,
} from "./types";
import type {
  ModelDSL,
  ServiceHooks,
  ApiDSL,
  TableDSL,
  AclDSL,
  DataResourceMeta,
  DslAppData,
  DslModelEntry,
} from "./types";
import { BaseModelDSL } from "./base";

function tryImport<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    delete require.cache[require.resolve(path)];
    const mod = require(path);
    return (mod.default ?? mod) as T;
  } catch (err) {
    console.warn(`Failed to import ${path}:`, err);
    return undefined;
  }
}

function tryReadJSON<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err) {
    console.warn(`Failed to read JSON ${path}:`, err);
    return undefined;
  }
}

function loadModelDSL(dir: string): ModelDSL | undefined {
  const jsonPath = join(dir, "model.json");
  const jsPath = join(dir, "model.js");

  // Prefer model.json as the source of truth for DSL metadata so features
  // like dataResource are not lost when model.js only exports a class.
  const jsonValue = tryReadJSON<ModelDSL>(jsonPath);
  if (jsonValue) {
    return jsonValue;
  }

  const jsValue = tryImport<BaseModelDSL | ModelDSL>(jsPath);
  if (jsValue) {
    if (jsValue instanceof BaseModelDSL) {
      return jsValue.toModelConfig();
    }
    return jsValue as ModelDSL;
  }

  return undefined;
}

function loadServiceHooks(dir: string): ServiceHooks {
  const jsPath = join(dir, "service.js");
  return tryImport<ServiceHooks>(jsPath) ?? {};
}

function loadApiDSL(dir: string): ApiDSL | undefined {
  return tryReadJSON<ApiDSL>(join(dir, "api.json"));
}

function loadTableDSL(dir: string): TableDSL | undefined {
  const jsPath = join(dir, "table.js");
  const jsonPath = join(dir, "table.json");
  return tryImport<TableDSL>(jsPath) ?? tryReadJSON<TableDSL>(jsonPath);
}

function loadAclDSL(dir: string): AclDSL | undefined {
  const jsPath = join(dir, "acl.js");
  const jsonPath = join(dir, "acl.json");
  const jsValue = tryImport<AclDSL | ((ctx: unknown) => unknown)>(jsPath);
  if (jsValue) {
    if (typeof jsValue === "function") {
      return { rules: jsValue } as unknown as AclDSL;
    }
    return jsValue;
  }
  return tryReadJSON<AclDSL>(jsonPath);
}

function modelNameFromDir(dir: string, srcPath: string): string {
  const relative = dir.slice(srcPath.length).replace(/^\/+/, "").replace(/\/+/g, "_");
  return relative;
}
export function loadDslAppData(srcPath: string): DslAppData {
  const result: DslAppData = {
    models: {},
    services: {},
    apis: {},
    tables: {},
    acls: {},
    dataResources: {},
  };

  if (!existsSync(srcPath)) return result;

  function scan(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const stat = statSync(entryPath);
      if (!stat.isDirectory()) continue;
      scan(entryPath);
    }

    const dsl = loadModelDSL(dir);
    if (!dsl) return;

    const name = dsl.table || modelNameFromDir(dir, srcPath);
    const baseName = basename(dir);
    const tableName = dsl.table || baseName;

    result.models[name] = {
      name,
      path: dir,
      dsl,
      modelConfig: dsl as unknown as DslModelEntry["modelConfig"],
    };

    if (dsl.dataResource) {
      const resourceCode = dsl.dataResource.resourceCode ?? name;
      result.dataResources[resourceCode] = {
        resourceCode,
        modelName: name,
        ...dsl.dataResource,
      };
    }

    const hooks = loadServiceHooks(dir);
    if (Object.keys(hooks).length > 0) {
      result.services[name] = { name, path: dir, hooks };
    }

    const api = loadApiDSL(dir);
    if (api?.routes?.length) {
      result.apis[name] = { name, path: dir, routes: api.routes };
    }

    const table = loadTableDSL(dir);
    if (table) {
      result.tables[name] = { name, path: dir, table };
    } else {
      result.tables[name] = {
        name,
        path: dir,
        table: { title: name, model: tableName },
      };
    }

    const acl = loadAclDSL(dir);
    if (acl) {
      result.acls[name] = { name, path: dir, acl };
    }
  }

  scan(srcPath);
  return result;
}
