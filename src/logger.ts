/**
 * Logger built on Bun native APIs only.
 *
 * Bun native primitives used:
 * - console.debug/info/warn/error  → terminal分级输出
 * - Bun.file(path).writer()  → FileSink 高性能流式写入（Bun 特有）
 * - Bun.file(path)  → 懒加载文件引用 + stat 查询
 * - Bun.inspect(obj, { colors: false, depth: 5 })  → 对象序列化（比 JSON.stringify 更适合日志）
 * - process.stdout.write / process.stderr.write  → 直接写终端，绕过 console 格式化开销
 *
 * Bun 没有内置日志框架（无 bun:logger），因此这是原生能力的 thin wrapper。
 */

export interface LoggerConfig {
  level?: "debug" | "info" | "warn" | "error";
  console?: boolean;
  file?: string;
  maxSize?: number;
  maxFiles?: number;
  formatter?: (level: string, msg: string, date: Date) => string;
}

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const;

type LevelKey = keyof typeof LEVEL_ORDER;

interface FileSink {
  write(chunk: string): number;
  flush(): void;
  end(): void;
}

export class Logger {
  private level: LevelKey;
  private consoleEnabled: boolean;
  private filePath: string;
  private maxSize: number;
  private maxFiles: number;
  private formatter: (level: string, msg: string, date: Date) => string;
  private currentSize = 0;
  private sink?: FileSink;
  private _writing = false;
  private _queue: Array<() => Promise<void>> = [];

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? "info";
    this.consoleEnabled = config.console ?? true;
    this.filePath = config.file ?? "";
    this.maxSize = config.maxSize ?? 50 * 1024 * 1024;
    this.maxFiles = config.maxFiles ?? 7;
    this.formatter =
      config.formatter ??
      ((level, msg, date) =>
        `[${date.toISOString()}] [${level.toUpperCase()}] ${msg}\n`);
  }

  private async ensureInit(): Promise<void> {
    if (this.sink) return;
    if (!this.filePath) return;

    const f = Bun.file(this.filePath);
    if (await f.exists()) {
      const stat = await f.stat();
      this.currentSize = stat.size;
    } else {
      this.currentSize = 0;
    }

    // Bun FileSink is Bun-native high-performance streaming writer
    this.sink = (Bun.file(this.filePath).writer() as unknown) as FileSink;
  }

  private shouldLog(level: LevelKey): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LevelKey, raw: unknown): void {
    if (!this.shouldLog(level)) return;
    const msg =
      typeof raw === "string"
        ? raw
        : raw instanceof Error
          ? raw.message + "\n" + (raw.stack ?? "")
          : Bun.inspect(raw, { colors: false, depth: 5 });
    const line = this.formatter(level, msg, new Date());
    if (this.consoleEnabled) {
      const out =
        level === "error" || level === "warn" ? process.stderr : process.stdout;
      out.write(line);
    }
    if (this.filePath) {
      const operation = async () => {
        await this.ensureInit();
        await this.rotateIfNeeded(Buffer.byteLength(line, "utf-8"));
        this.sink!.write(line);
        this.sink!.flush();
        this.currentSize += Buffer.byteLength(line, "utf-8");
      };
      if (this._writing) {
        this._queue.push(operation);
        return;
      }
      this._writing = true;
      void (async () => {
        try {
          await operation();
        } finally {
          this._writing = false;
          // Drain queue
          while (this._queue.length > 0) {
            const next = this._queue.shift()!;
            this._writing = true;
            try {
              await next();
            } finally {
              this._writing = false;
            }
          }
        }
      })();
    }
  }

  private async rotateIfNeeded(bytes: number): Promise<void> {
    if (this.currentSize + bytes <= this.maxSize) return;

    // Close current sink
    this.sink!.end();
    this.sink = undefined;

    // Rotate: app.log.6 → app.log.7, ..., app.log → app.log.1
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${this.filePath}.${i}`;
      const dst = `${this.filePath}.${i + 1}`;
      try {
        const srcFile = Bun.file(src);
        if (await srcFile.exists()) {
          await Bun.write(dst, srcFile);
        }
      } catch {
        // ignore missing source
      }
    }

    try {
      const currentFile = Bun.file(this.filePath);
      if (await currentFile.exists()) {
        await Bun.write(`${this.filePath}.1`, currentFile);
      }
    } catch {
      // ignore
    }

    // Truncate current file and reopen sink
    await Bun.write(this.filePath, "");
    this.currentSize = 0;
    this.sink = (Bun.file(this.filePath).writer() as unknown) as FileSink;
  }

  debug(msg: unknown): void {
    this.write("debug", msg);
  }

  info(msg: unknown): void {
    this.write("info", msg);
  }

  warn(msg: unknown): void {
    this.write("warn", msg);
  }

  error(msg: unknown): void {
    this.write("error", msg);
  }
}
