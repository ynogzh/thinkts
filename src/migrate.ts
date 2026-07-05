import { Model } from "./model";
import { createThink } from "./think";
import { loadConfig } from "./config";

export interface Migration {
  name: string;
  up: (db: Model) => Promise<void>;
  down?: (db: Model) => Promise<void>;
}

export interface MigrateOptions {
  table?: string;
  dir?: string;
  adapter?: string;
}

interface MigrationRecord {
  name: string;
  executed_at: number;
}

export class Migrator {
  private model: Model;
  private dir: string;
  private table: string;

  constructor(model: Model, options: MigrateOptions = {}) {
    this.model = model;
    this.dir = options.dir ?? "./migration";
    this.table = options.table ?? "_migrations";
  }

  /** Ensure migration tracking table exists */
  async init(): Promise<void> {
    try {
      await this.model.db().query.execute(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          name VARCHAR(255) PRIMARY KEY,
          executed_at INTEGER NOT NULL
        )
      `);
    } catch (err) {
      // Log but don't throw — migration table may already exist with different schema
      if (err instanceof Error && !err.message.includes("already exists")) {
        console.warn(`Migration init warning: ${err.message}`);
      }
    }
  }

  /** List all migration files sorted */
  private async listFiles(): Promise<{ name: string; path: string }[]> {
    const glob = new Bun.Glob(`${this.dir}/**/*.ts`);
    const files: { name: string; path: string }[] = [];
    for await (const file of glob.scan({ absolute: true })) {
      const basename = file.split("/").pop() ?? "";
      if (/^\d{14}_.+\.ts$/.test(basename)) {
        files.push({ name: basename.replace(/\.ts$/, ""), path: file });
      }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get already executed migrations */
  private async getExecuted(): Promise<Set<string>> {
    try {
      const rows = await this.model.db().query.select({
        table: this.table,
        field: ["name"],
      });
      return new Set((rows as MigrationRecord[]).map((r) => r.name));
    } catch {
      return new Set();
    }
  }

  /** Run pending migrations */
  async up(): Promise<string[]> {
    await this.init();
    const files = await this.listFiles();
    const executed = await this.getExecuted();
    const ran: string[] = [];

    for (const file of files) {
      if (executed.has(file.name)) continue;

      const mod = require(file.path) as { up?: (db: Model) => Promise<void> };
      if (!mod.up) {
        throw new Error(`Migration ${file.name} missing up() method`);
      }
      await mod.up(this.model);
      await this.model.add({ name: file.name, executed_at: Date.now() }, { table: this.table });
      ran.push(file.name);
    }

    return ran;
  }

  /** Rollback last batch */
  async down(count = 1): Promise<string[]> {
    await this.init();
    const executed = Array.from(await this.getExecuted()).sort().reverse();
    const rolled: string[] = [];

    for (let i = 0; i < Math.min(count, executed.length); i++) {
      const name = executed[i];
      const path = `${this.dir}/${name}.ts`;
      const mod = require(path) as { down?: (db: Model) => Promise<void> };
      if (mod.down) {
        await mod.down(this.model);
      }
      await this.model.where({ name }).delete({ table: this.table });
      rolled.push(name);
    }

    return rolled;
  }

  /** Show status */
  async status(): Promise<{ pending: string[]; executed: string[] }> {
    await this.init();
    const files = await this.listFiles();
    const executed = await this.getExecuted();
    return {
      pending: files.map((f) => f.name).filter((n) => !executed.has(n)),
      executed: Array.from(executed),
    };
  }
}

/** CLI entry */
export async function runMigrateCLI(args: string[], rootPath: string): Promise<void> {
  const command = args[0] ?? "up";

  const appConfig = loadConfig(rootPath, process.env.NODE_ENV ?? "development");
  const think = createThink(rootPath, appConfig);
  const modelConfig = think.config("model", {}) as Record<string, unknown>;
  const model = new Model("_migrations", modelConfig);

  const migrator = new Migrator(model, {
    dir: `${rootPath}/migration`,
    table: "_migrations",
  });

  switch (command) {
    case "up": {
      const ran = await migrator.up();
      console.log(ran.length > 0 ? `Migrated: ${ran.join(", ")}` : "No pending migrations");
      break;
    }
    case "down": {
      const count = parseInt(args[1] ?? "1", 10);
      const rolled = await migrator.down(count);
      console.log(rolled.length > 0 ? `Rolled back: ${rolled.join(", ")}` : "Nothing to rollback");
      break;
    }
    case "status": {
      const status = await migrator.status();
      console.log(`Executed (${String(status.executed.length)}):`);
      status.executed.forEach((n) => console.log(`  ✓ ${n}`));
      console.log(`Pending (${String(status.pending.length)}):`);
      status.pending.forEach((n) => console.log(`  ○ ${n}`));
      break;
    }
    default:
      console.log("Usage: think migrate [up|down|status]");
  }
}
