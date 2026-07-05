# ThinkTS v2 — 架构设计

## 设计哲学

| 原则 | 含义 |
|------|------|
| **类型优先** | 编译时检查一切，禁止 `any`、`as unknown as`、`Record<string, unknown>` |
| **零魔法** | 无隐式推断、无全局状态、无字符串反射 |
| **组合优于继承** | mixin 函数 > 深层 class 链 |
| **Bun 原生** | `Bun.sql`、`Bun.file`、`Bun.serve` — 不引入 ORM 抽象层 |
| **启动即用** | `import { thinkts } from "thinkts"` → 3 行代码启动 |
| **可观测** | traceId 贯穿全链路，结构化日志，开发模式显示 SQL |

## 架构总览

```
thinkts/
├── src/
│   ├── app.ts              # Application — 组装一切，启动服务
│   ├── router/
│   │   ├── radix.ts        # Radix 树路由 (O(k) 匹配，k=路径长度)
│   │   └── compiler.ts     # 路由预编译为函数调用
│   ├── context/
│   │   ├── request.ts      # RequestContext (不可变快照)
│   │   └── response.ts     # Response builder
│   ├── model/
│   │   ├── core.ts         # Model — 流畅查询构建器
│   │   ├── acl.ts          # withAcl() mixin
│   │   ├── relation.ts     # withRelations() mixin
│   │   └── adapters/       # MySQL / SQLite / Postgres
│   ├── dsl/
│   │   ├── define.ts       # defineModel() / defineService()
│   │   ├── loader.ts       # 模块扫描 + 热重载
│   │   └── codegen.ts      # CLI 代码生成
│   ├── auth/
│   │   ├── jwt.ts          # JWT sign/verify
│   │   └── session.ts      # 会话管理
│   ├── validation/
│   │   └── schema.ts       # 基于 TypeScript 类型的验证
│   ├── middleware/
│   │   ├── compose.ts      # 中间件组合
│   │   ├── cors.ts
│   │   ├── ratelimit.ts
│   │   └── logger.ts
│   ├── error.ts            # 结构化错误
│   └── logger.ts           # 请求级日志
└── index.ts                # 公开 API
```

## 1. 应用入口

```ts
// myapp/src/main.ts
import { thinkts } from "thinkts";

const app = thinkts({
  routes: "./src/routes",     // 自动扫描
  database: { type: "sqlite", path: "./data.db" },
  auth: { jwt: { secret: env.JWT_SECRET } },
});

app.get("/health", () => ({ status: "ok" }));

app.start({ port: 3000 });
```

## 2. 路由 — Radix Tree + 预编译

**当前**：正则匹配 + 字符串查找，O(n) 遍历  
**目标**：Radix 树，O(k) 匹配，k = URL 段数

```ts
// 内部表示
const tree = new RadixTree();

tree.insert("/iotbiz/device/category/list",  handler1);
tree.insert("/iotbiz/device/category/create", handler2);
tree.insert("/iotbiz/device/:id/update",      handler3);

// 匹配 /iotbiz/device/42/update → { handler: handler3, params: { id: "42" } }
const match = tree.match("/iotbiz/device/42/update");
```

编译时生成：
```ts
// 预编译后的匹配函数 (零查找，纯 switch)
function matchRoute(path: string) {
  const seg = path.split("/");
  if (seg[1] === "iotbiz" && seg[2] === "device") {
    if (seg[3] === "category" && seg[4] === "list") return handler1;
    if (seg[3] === "category" && seg[4] === "create") return handler2;
    if (seg[4] === "update") return handler3; // :id 在 seg[3]
  }
  return null;
}
```

## 3. 上下文 — 不可变快照

**当前**：`ThinkContext` 是一个可变对象，`_currentCtx` 是全局状态  
**目标**：`RequestContext` 是不可变快照，通过函数参数传递

```ts
interface RequestContext {
  readonly request: Request;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly user: User | null;
  readonly traceId: string;
  readonly startedAt: number;
}

// Handler 签名
type Handler<T = unknown> = (ctx: RequestContext) => T | Promise<T>;

// 需要写操作时返回一个新的 Response 对象
function respond(body: unknown, status?: number): Response {
  return new Response(JSON.stringify(body), {
    status: status ?? 200,
    headers: { "content-type": "application/json" },
  });
}
```

## 4. Model — Mixin 函数组合

**当前**：5 层 class 继承  
**目标**：3 个 mixin 函数 + 1 个核心类

```ts
// 核心 — 流畅查询
class QueryBuilder<T = Record<string, never>> {
  private _where: WhereClause[] = [];
  private _order: string[] = [];
  private _limit?: number;
  private _offset?: number;

  where(clause: WhereClause): this { this._where.push(clause); return this; }
  order(by: string): this { this._order.push(by); return this; }
  limit(n: number): this { this._limit = n; return this; }

  async select(): Promise<T[]> { /* 执行 SQL */ }
  async first(): Promise<T | null> { /* LIMIT 1 */ }
  async count(): Promise<number> { /* SELECT COUNT(*) */ }
}

// Mixin — ACL 行级过滤
function withAcl<TBase extends Constructor<QueryBuilder>>(Base: TBase) {
  return class extends Base {
    private _aclRole?: string;
    private _aclCtx?: RequestContext;

    acl(role: string, ctx: RequestContext): this {
      this._aclRole = role;
      this._aclCtx = ctx;
      // 自动注入 tenant_id 过滤
      return this.where({ tenant_id: ctx.user?.tenantId });
    }
  };
}

// Mixin — 关联查询
function withRelations<TBase extends Constructor<QueryBuilder>>(Base: TBase) {
  return class extends Base {
    private _with: string[] = [];

    with(relation: string): this { this._with.push(relation); return this; }
    // select() 自动 JOIN + 嵌套
  };
}

// 组合
const Model = withRelations(withAcl(QueryBuilder));
```

## 5. DSL — TypeScript First

**当前**：JSON 定义 schema + JS 写 hook  
**目标**：TypeScript 定义一切，类型自动推导

```ts
// src/iotbiz/device/category/model.ts
import { defineModel, t } from "thinkts/dsl";

export const DeviceCategory = defineModel("iotbiz_device_category", {
  columns: {
    id: t.bigint().primary().autoIncrement(),
    tenantId: t.bigint("tenant_id").required(),
    code: t.varchar(64).required().unique(),
    name: t.varchar(128).required(),
    description: t.varchar(500).optional(),
    status: t.enum(["enabled", "disabled"]).default("enabled"),
    createdAt: t.timestamp("created_at").defaultNow(),
  },
  
  acl: {
    superadmin: { allow: ["select", "find", "add", "update", "delete"] },
    admin:     { allow: ["select", "find", "add", "update"] },
    user:      { allow: ["select", "find"] },
  },

  hooks: {
    async beforeCreate(ctx, data) {
      // data 类型自动推导为 { code: string; name: string; ... }
      data.status ??= "enabled";
      return data;
    },
  },
});

// 使用 — 完整类型推导
const list = await DeviceCategory.where({ status: "enabled" })
  .order("sort_order asc")
  .select();
// list 类型: Array<{ id: bigint; tenantId: bigint; code: string; name: string; ... }>
```

## 6. 验证 — 类型即 Schema

**当前**：valibot 可选依赖，手动调用  
**目标**：TypeScript 类型自动生成验证

```ts
import { validate, t } from "thinkts/validation";

const CreateUserSchema = t.object({
  username: t.string().min(3).max(64),
  email: t.string().email(),
  role: t.enum(["admin", "user"]).default("user"),
});

// Handler 中使用
async function createUser(ctx: RequestContext) {
  const input = validate(CreateUserSchema, ctx.body);
  // input 类型: { username: string; email: string; role: "admin" | "user" }
  // 自动返回 400 + 字段级错误信息
}
```

## 7. 错误处理 — 结构化 + 可调试

```ts
class AppError extends Error {
  constructor(
    readonly code: string,        // "MODEL_NOT_FOUND"
    readonly status: number,      // 404
    readonly detail?: unknown,    // { modelName: "iotbiz_device_category" }
  ) {
    super(`${code}: ${detail}`);
  }
}

// 全局错误处理器
app.onError((error, ctx) => {
  if (error instanceof AppError) {
    return respond({ code: error.code, detail: error.detail }, error.status);
  }
  // 开发模式显示完整堆栈
  if (isDev) {
    return respond({ 
      message: error.message, 
      stack: error.stack,
      sql: ctx.sql,  // 最后执行的 SQL
      traceId: ctx.traceId,
    }, 500);
  }
  return respond({ message: "Internal Server Error" }, 500);
});
```

## 8. 中间件 — 函数式组合

```ts
type Middleware = (
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

// 内置中间件
app.use(logger());           // 请求日志 + 耗时
app.use(cors({ origin: "*" }));
app.use(ratelimit({ max: 100, window: "1m" }));
app.use(auth({ jwt: true }));

// 自定义中间件
app.use(async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
  return response;
});
```

## 9. 日志 — 结构化 + 链路追踪

```ts
app.use(logger({
  level: "info",
  format: "json",  // 生产用 JSON
  fields: ["method", "path", "status", "duration", "userId", "traceId"],
}));

// 输出
// {"level":"info","method":"GET","path":"/iotbiz/device/list","status":200,"duration":12,"userId":42,"traceId":"abc123"}
```

## 10. 配置 — 分层 + 环境感知

```ts
// config/default.ts
export default {
  port: 3000,
  database: { type: "sqlite", path: "./data.db" },
  auth: { jwt: { expiresIn: "24h" } },
};

// config/production.ts
export default {
  port: 8080,
  database: { type: "mysql", host: env.DB_HOST },
  logger: { format: "json" },
};

// 自动合并: default ← development ← production
```

## 性能指标

| 指标 | v1 现状 | v2 目标 |
|------|--------|--------|
| 启动时间 (iotbiz) | ~3s | <500ms |
| 路由匹配 | O(n) 遍历 | O(k) Radix |
| 请求延迟 (p50) | ~50ms | <5ms |
| 类型安全 | 部分 `any` | 零 `any` |
| 文件扫描 | 5 次遍历 | 1 次遍历 |
| 热重载 | 不支持 | 秒级 |
