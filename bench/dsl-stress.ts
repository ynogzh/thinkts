#!/usr/bin/env bun
/**
 * HTTP-level stress benchmark for DSL-generated routes.
 *
 * Usage:
 *   bun bench/dsl-stress.ts [concurrency] [total] [port]
 *
 * Example:
 *   bun bench/dsl-stress.ts 64 10000 9877
 */

import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { Application } from "../src/application";

const concurrency = Number(process.argv[2] ?? 64);
const total = Number(process.argv[3] ?? 10000);
const port = Number(process.argv[4] ?? 9877);

const DB_HOST = "47.106.95.106";
const DB_PORT = 3306;
const DB_USER = "root";
const DB_PASSWORD = "Lucky777!!!";
const DB_NAME = "duoduowan_clean_codex";

function now(): number {
  return performance.now();
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function stats(timesMs: number[]) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const totalMs = sorted.reduce((a, b) => a + b, 0);
  const avg = totalMs / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  return { avg, p50, p90, p99, totalMs };
}

async function runConcurrent<T>(
  workers: number,
  count: number,
  task: (i: number) => Promise<T>
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  const pool = Array.from({ length: workers }, async () => {
    const local: T[] = [];
    while (true) {
      const i = index++;
      if (i >= count) break;
      local.push(await task(i));
    }
    return local;
  });
  for (const batch of await Promise.all(pool)) {
    results.push(...batch);
  }
  return results;
}

interface FixtureOptions {
  feature: string;
  model: string;
  table: string;
  pk: string;
  route: string;
}

function scaffold(root: string, fixture: FixtureOptions): void {
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "src", fixture.feature), { recursive: true });

  writeFileSync(
    join(root, "config", "config.ts"),
    `export default {
  port: ${port},
  host: "127.0.0.1",
  logger: { level: "error" },
};`
  );

  writeFileSync(join(root, "config", "middleware.ts"), `export default [];`);
  writeFileSync(join(root, "config", "router.ts"), `export default [];`);

  writeFileSync(
    join(root, "config", "adapter.ts"),
    `import { createSQLAdapter } from "thinkts";

const SQLAdapter = createSQLAdapter({
  adapter: "mysql",
  host: "${DB_HOST}",
  port: ${DB_PORT},
  user: "${DB_USER}",
  password: "${DB_PASSWORD}",
  database: "${DB_NAME}",
  max: 10,
  idleTimeout: 30,
  maxLifetime: 0,
});

export default {
  model: {
    type: "mysql",
    adapter: "mysql",
    prefix: "",
    pagesize: 20,
    handle: SQLAdapter,
    host: "${DB_HOST}",
    port: ${DB_PORT},
    user: "${DB_USER}",
    password: "${DB_PASSWORD}",
    database: "${DB_NAME}",
  },
};`
  );

  writeFileSync(
    join(root, "src", fixture.feature, "model.json"),
    JSON.stringify(
      {
        name: fixture.model,
        table: fixture.table,
        comment: `${fixture.table} table`,
        primaryKey: fixture.pk,
        columns: [
          { name: fixture.pk, type: "ID", primary: true, autoIncrement: true },
          { name: "tenant_id", type: "bigint", required: true },
          { name: "tag_code", type: "string", length: 64, required: true, index: true },
          { name: "tag_name", type: "string", length: 128, required: true },
          { name: "tag_type", type: "string", length: 64, required: true },
          { name: "status", type: "string", length: 32, default: "active" },
          { name: "created_at", type: "timestamp" },
          { name: "updated_at", type: "timestamp" },
        ],
        relations: {},
        indexes: [],
        option: { timestamps: false, softDeletes: false },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(root, "src", fixture.feature, "service.js"),
    `export async function beforeList(ctx, query) {
  return query;
}
export async function afterList(ctx, result) {
  return result;
}
export async function beforeCreate(ctx, data) {
  data.created_at = new Date();
  return data;
}
export async function afterCreate(ctx, record) {
  return record;
}`
  );

  writeFileSync(
    join(root, "src", fixture.feature, "acl.json"),
    JSON.stringify(
      {
        roles: ["superadmin", "admin", "user", "guest"],
        rules: {
          "*": {
            superadmin: { allow: ["select", "find", "add", "update", "delete"] },
            admin: { allow: ["select", "find", "add", "update", "delete"] },
            user: { allow: ["select", "find"], writable: ["tag_name", "status"], deny: ["delete", "add"] },
            guest: { deny: ["select", "find", "add", "update", "delete"] },
          },
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(root, "src", fixture.feature, "table.json"),
    JSON.stringify(
      {
        title: `${fixture.table} management`,
        model: fixture.table,
        list: {
          columns: [
            { field: fixture.pk, title: "ID", width: 80 },
            { field: "tag_code", title: "Code", width: 160 },
            { field: "tag_name", title: "Name", width: 200 },
            { field: "tag_type", title: "Type", width: 120 },
            { field: "status", title: "Status", width: 100, render: "tag" },
            { field: "created_at", title: "Created", width: 180, format: "datetime" },
          ],
          orderBy: { field: fixture.pk, direction: "desc" },
          pageSize: 20,
          rowActions: [
            { type: "view", title: "View" },
            { type: "edit", title: "Edit" },
            { type: "delete", title: "Delete", confirm: "Confirm delete?" },
          ],
          headerActions: [{ type: "create", title: "Create", icon: "plus" }],
        },
        search: {
          fields: [
            { field: "tag_code", title: "Code", type: "input", operator: "like" },
            { field: "tag_name", title: "Name", type: "input", operator: "like" },
            { field: "status", title: "Status", type: "select", options: [{ label: "All", value: "" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }] },
          ],
          showCount: 3,
        },
        form: {
          groups: [
            {
              title: "Basic",
              columns: 2,
              fields: [
                { field: "tag_code", title: "Code", type: "input", required: true },
                { field: "tag_name", title: "Name", type: "input", required: true },
                { field: "tag_type", title: "Type", type: "input", required: true },
                { field: "status", title: "Status", type: "select", options: [{ label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }] },
              ],
            },
          ],
          modes: {
            create: { fields: ["tag_code", "tag_name", "tag_type", "status"] },
            edit: { fields: ["tag_name", "tag_type", "status"], readonly: ["tag_code"] },
            view: { fields: [fixture.pk, "tag_code", "tag_name", "tag_type", "status", "created_at"] },
          },
        },
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const root = join(tmpdir(), `thinkts-dsl-stress-${Date.now()}`);
  const fixture: FixtureOptions = {
    feature: "user/tags",
    model: "UserTag",
    table: "user_tags",
    pk: "id",
    route: "user_tags",
  };
  scaffold(root, fixture);

  const app = new Application({
    ROOT_PATH: root,
    env: "test",
    port,
    host: "127.0.0.1",
  });

  await app.run();
  const base = `http://127.0.0.1:${port}`;

  const probeUrls = [
    `${base}/api/${fixture.route}`,
    `${base}/admin/api/tables`,
    `${base}/admin/api/table/${fixture.route}`,
  ];
  for (const url of probeUrls) {
    const res = await fetch(url);
    if (res.status !== 200) {
      const text = await res.text();
      app.stop();
      rmSync(root, { recursive: true, force: true });
      throw new Error(`DSL route not ready: ${url} => ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  const endpoints = [
    () => `${base}/api/${fixture.route}`,
    (i: number) => `${base}/api/${fixture.route}/${(i % 4) + 1}`,
  ];

  for (let i = 0; i < 200; i++) {
    await fetch(endpoints[i % endpoints.length](i));
  }

  const errors: string[] = [];
  const times: number[] = [];

  const t0 = now();
  const results = await runConcurrent(concurrency, total, async (i) => {
    const url = endpoints[i % endpoints.length](i);
    const reqStart = now();
    try {
      const res = await fetch(url);
      const text = await res.text();
      times.push(now() - reqStart);
      if (res.status !== 200) {
        errors.push(`${url} => ${res.status}: ${text.slice(0, 100)}`);
      }
      return res.status;
    } catch (err) {
      times.push(now() - reqStart);
      errors.push(`${url} => ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  });
  const elapsed = now() - t0;

  app.stop();
  rmSync(root, { recursive: true, force: true });

  const success = results.filter((s) => s === 200).length;
  const s = stats(times);

  console.log(`\n=== ThinkTS DSL HTTP Stress Benchmark ===`);
  console.log(`Feature     : ${fixture.feature}`);
  console.log(`Model       : ${fixture.model}`);
  console.log(`Route       : /api/${fixture.route}`);
  console.log(`Concurrency : ${concurrency}`);
  console.log(`Total req   : ${total}`);
  console.log(`Success     : ${success}/${total}`);
  console.log(`Errors      : ${errors.length}`);
  console.log(`Duration    : ${fmt(elapsed)} ms`);
  console.log(`Throughput  : ${fmt((total / elapsed) * 1000)} req/s`);
  console.log(`Avg latency : ${fmt(s.avg)} ms`);
  console.log(`P50 latency : ${fmt(s.p50)} ms`);
  console.log(`P90 latency : ${fmt(s.p90)} ms`);
  console.log(`P99 latency : ${fmt(s.p99)} ms`);

  if (errors.length > 0) {
    console.log(`\nFirst errors:`);
    for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
