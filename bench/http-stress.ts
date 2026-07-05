#!/usr/bin/env bun
/**
 * HTTP-level stress benchmark for ThinkTS.
 *
 * Usage:
 *   bun bench/http-stress.ts [concurrency] [total] [port]
 *
 * Example:
 *   bun bench/http-stress.ts 128 100000 9876
 */

import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { Application } from "../src/application";

const concurrency = Number(process.argv[2] ?? 64);
const total = Number(process.argv[3] ?? 50000);
const port = Number(process.argv[4] ?? 9876);

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

function writeController(root: string, feature: string, name: string, body: string): void {
  mkdirSync(join(root, "src", feature), { recursive: true });
  writeFileSync(
    join(root, "src", feature, "controller.ts"),
    `export default class ${name}Controller {
      ctx: unknown;
      constructor(ctx: unknown) { this.ctx = ctx; }
${body}
    }`
  );
}

function scaffold(root: string): void {
  mkdirSync(join(root, "config"), { recursive: true });

  writeFileSync(
    join(root, "config", "config.ts"),
    `export default {
      port: ${port},
      host: "127.0.0.1",
      logger: { level: "error" },
    };`
  );

  writeFileSync(
    join(root, "config", "middleware.ts"),
    `export default [];`
  );

  writeFileSync(
    join(root, "config", "router.ts"),
    `export default [];`
  );

  writeController(
    root,
    "index",
    "Index",
    `      indexAction() {
        return { hello: "world" };
      }`
  );

  writeController(
    root,
    "bench",
    "Bench",
    `      indexAction() {
        return { ok: true };
      }
      echoAction(opts: Record<string, unknown>) {
        return { echo: opts.msg ?? "hello" };
      }
      calcAction(opts: Record<string, unknown>) {
        const n = Number(opts.n ?? 100);
        let sum = 0;
        for (let i = 1; i <= n; i++) sum += i;
        return { n, sum };
      }`
  );
}

async function main(): Promise<void> {
  const root = join(tmpdir(), `thinkts-http-stress-${Date.now()}`);
  scaffold(root);

  const app = new Application({
    ROOT_PATH: root,
    env: "test",
    port,
    host: "127.0.0.1",
  });

  await app.run();
  const base = `http://127.0.0.1:${port}`;

  const endpoints = [
    () => `${base}/`,
    () => `${base}/bench/index`,
    (i: number) => `${base}/bench/echo?msg=${i}`,
    (i: number) => `${base}/bench/calc?n=${10 + (i % 100)}`,
  ];

  // Warm-up
  for (let i = 0; i < 1000; i++) {
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

  console.log(`\n=== ThinkTS HTTP Stress Benchmark ===`);
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
