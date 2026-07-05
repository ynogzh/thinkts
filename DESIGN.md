# ThinkTS 服务器框架设计规范 v2.0

## 目录
1. 核心设计决策
2. 模块详解
3. 数据流与生命周期
4. API 设计
5. 性能架构
6. 错误模型
7. 安全模型
8. 迁移路径

---

## 1. 核心设计决策

### 1.1 类型优先原则

框架的每一层都携带类型信息。不存在 `any`、`unknown`、`as` 强制转换。

```
用户代码类型 → Handler 推导 → Model 推导 → SQL 参数类型 → 数据库列类型
     ↑                                                         |
     └──────────── 响应类型自动推导 ───────────────────────────┘
```

**反例 (v1)**：
```ts
const m = this.model();                     // Model<Record<string, unknown>>
const user = await m.where({ id: 1 }).find(); // user: Record<string, unknown>
```

**目标 (v2)**：
```ts
const user = await UserModel.find(1);
// user: { id: number; username: string; email: string; status: "enabled" | "disabled" }
```

### 1.2 零动态派发

所有路由、模型、服务调用在模块加载时完成绑定。运行时零反射、零字符串查找。

| 操作 | v1 开销 | v2 开销 |
|------|--------|--------|
| 路由匹配 | O(n) 遍历正则 | O(k) Radix 节点跳转 |
| 模型解析 | `parseModelRoute` + `toPascalCase` | 编译时生成 |
| 服务调用 | 4 层 try/catch + 字符串拼接 | 直接函数调用 |
| ACL 检查 | 运行时读 `model.json` | 编译时注入 mixin |

### 1.3 不可变请求上下文

`RequestContext` 在请求开始时创建，整个生命周期内不变。任何需要修改的状态通过函数返回值传递。

```ts
// v1 — 可变
ctx.user = { id: 1 };
ctx.think._currentCtx = ctx;

// v2 — 不可变
const ctx = RequestContext.from(request, { user, traceId });
const result = await handler(ctx);
respond(result, ctx);
```

### 1.4 函数组合优于类继承

深层类链用函数组合替代。每个功能是独立的 mixin 函数。

```
QueryBuilder
  ← withAcl(queryBuilder)           // 行级过滤
  ← withRelations(queryBuilder)     // JOIN + 嵌套
  ← withSoftDelete(queryBuilder)    // 软删除
  ← withTimestamps(queryBuilder)    // created_at / updated_at
```

---

## 2. 模块详解

### 2.1 Router — Radix Tree

每个 URL 段是一个节点，节点存储 handler 引用和通配符/参数子节点。

```
树结构：
/
├── health → handler_health
├── api/
│   ├── open/
│   │   ├── login → handler_login
│   │   └── refresh → handler_refresh
│   └── iotbiz/
│       ├── device/
│       │   ├── :id/          (动态参数)
│       │   │   ├── update → handler_device_update
│       │   │   └── delete → handler_device_delete
│       │   └── list → handler_device_list
│       └── ...
└── admin/
    └── ...
```

**匹配算法**：
```
fn match(tree, path):
  node = tree.root
  params = {}
  for segment in path:
    if segment in node.static:
      node = node.static[segment]
    else if node.param:
      params[node.param.name] = segment
      node = node.param.child
    else:
      return null
  return (node.handler, params)
```

时间复杂度：O(k)，k = URL 段数。不依赖路由总数。

**预编译输出**（生产模式）：
```ts
// 编译后的路由表，零查找
function matchRoute(path: string): Handler | null {
  const s = path.split("/");
  if (s[1] === "health" && s.length === 2) return handler_health;
  if (s[1] === "api" && s[2] === "open") {
    if (s[3] === "login" && s.length === 4) return handler_login;
    if (s[3] === "refresh" && s.length === 4) return handler_refresh;
  }
  // ... 继续
}
```

### 2.2 Model — 类型安全查询构建器

核心：`QueryBuilder<T>` 携带有完整的行类型 `T`，每个链式调用精炼类型。

```ts
class QueryBuilder<T extends Record<string, unknown>> {
  private clauses: QueryClause[] = [];

  where<K extends keyof T>(field: K, op: Operator, value: T[K]): this;
  where(conditions: Partial<T>): this;
  where(clause: WhereClause<T>): this;

  orderBy<K extends keyof T>(field: K, dir: "asc" | "desc"): this;
  limit(n: number): this;

  async select(): Promise<T[]>;
  async first(): Promise<T | null>;
  async count(): Promise<number>;

  // 关联查询 — 返回类型自动包含关联
  with<R extends keyof Relations<T>>(relation: R): QueryBuilder<T & { [K in R]: Relations<T>[K] }>;
}
```

**SQL 生成**：使用参数化查询，杜绝注入。

```ts
// 用户代码
await DeviceModel
  .where("status", "eq", "enabled")
  .where("merchant_id", "eq", 42)
  .orderBy("created_at", "desc")
  .limit(20)
  .select();

// 生成 SQL
// SELECT * FROM iotbiz_device WHERE status = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 20
// 参数: ["enabled", 42]
```

### 2.3 DSL — TypeScript 原生定义

**模型定义**：

```ts
// src/iotbiz/device/category.ts
import { defineModel, t, relations } from "thinkts";

export const DeviceCategory = defineModel("iotbiz_device_category", {
  columns: {
    id:            t.bigint().primary().autoIncrement(),
    tenant_id:     t.bigint().required().index(),
    code:          t.varchar(64).required().unique(),
    name:          t.varchar(128).required(),
    description:   t.varchar(500).optional(),
    icon:          t.varchar(128).optional(),
    sort_order:    t.integer().default(0),
    status:        t.enum(["enabled", "disabled"]).default("enabled"),
    created_at:    t.timestamp().defaultNow(),
    updated_at:    t.timestamp().defaultNow().onUpdate(),
  },

  relations: {
    profiles: relations.hasMany("DeviceProfile", "category_id"),
    skus:     relations.hasMany("DeviceSku", "category_id"),
  },

  hooks: {
    beforeCreate(data, ctx) {
      // data 类型完整推导: { code: string; name: string; tenant_id: bigint; ... }
      data.tenant_id = ctx.tenantId;
      return data;
    },
  },

  acl: {
    read:  ["superadmin", "admin", "user"],
    write: ["superadmin", "admin"],
  },
});

// 自动导出类型
export type DeviceCategoryRow = typeof DeviceCategory.row;
// { id: bigint; tenant_id: bigint; code: string; name: string; ... }
```

**CLI 生成器对标输出**：从 MySQL INFORMATION_SCHEMA 读取列定义，生成以上 `.ts` 文件。

### 2.4 Middleware — 洋葱模型

```ts
type Middleware = (ctx: Context, next: () => Promise<Response>) => Promise<Response>;

// 内置
app.use(logger());        // 请求日志，自动记录 method/path/status/duration
app.use(cors());          // CORS 头
app.use(ratelimit(100));  // 100 req/min per IP
app.use(auth.jwt());      // JWT 验证，自动注入 ctx.user

// 自定义
app.use(async (ctx, next) => {
  if (ctx.path.startsWith("/admin") && !ctx.user?.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return next();
});
```

**执行顺序**：
```
请求 → logger → cors → ratelimit → auth → 自定义 → handler → 响应
                                              ↓
                                          logger (记录耗时)
```

### 2.5 验证 — 内联类型推导

```ts
import { validate, t, Infer } from "thinkts";

const CreateDeviceSchema = t.object({
  device_no: t.string().min(6).max(64),
  name:      t.string().required(),
  type_id:   t.bigint().required(),
  merchant_id: t.bigint().required(),
  status:    t.enum(["enabled", "disabled"]).default("enabled"),
});

type CreateDeviceInput = Infer<typeof CreateDeviceSchema>;

// handler 中
function createDevice(ctx: Context, input: CreateDeviceInput) {
  // input 类型已验证 + 类型安全
  const device = await DeviceModel.create(input);
  return { data: device };
}

// 路由注册时自动绑验证
app.post("/iotbiz/device/create", createDevice, {
  validate: CreateDeviceSchema,  // 自动 400 on failure
});
```

### 2.6 错误模型 — 结构化异常

```ts
class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    override readonly message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }

  static notFound(resource: string, id: unknown) {
    return new AppError("NOT_FOUND", 404, `${resource} ${id} not found`, { resource, id });
  }

  static validationFailed(errors: ValidationError[]) {
    return new AppError("VALIDATION_FAILED", 400, "Validation failed", { errors });
  }

  static unauthorized(reason?: string) {
    return new AppError("UNAUTHORIZED", 401, reason ?? "Authentication required");
  }
}
```

**全局错误格式化**：

```ts
app.onError((error, ctx) => {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, detail: error.detail };
  }

  // 开发模式显示完整上下文
  if (isDev) {
    return {
      message: error.message,
      stack: error.stack,
      sql: ctx.lastQuery,       // 最后执行的 SQL
      traceId: ctx.traceId,
    };
  }

  return { message: "Internal Server Error", traceId: ctx.traceId };
});
```

---

## 3. 数据流与生命周期

```
1. Bun.serve 接收 HTTP 请求
       ↓
2. RequestContext.from(request) 创建不可变上下文
       ↓
3. Middleware 链执行 (洋葱模型)
       ↓
4. Router 匹配 → Handler
       ↓
5. Handler 执行业务逻辑 → 返回数据
       ↓
6. Response 序列化 (JSON / HTML / Stream)
       ↓
7. 日志记录 (method, path, status, duration, traceId)
```

**单次请求的内存分配**：
```
RequestContext  128B  (栈分配)
QueryBuilder    256B  (堆分配，复用连接池)
Response        1KB   (JSON 序列化)
────────────────────
总计            ~1.5KB / 请求
```

---

## 4. API 设计

### 公开 API (`import from "thinkts"`)

```ts
// 核心
export { thinkts } from "./app";              // 框架入口
export { defineModel, t, relations } from "./dsl";
export { validate, Infer } from "./validation";
export { AppError } from "./error";

// 类型
export type { Context } from "./context";
export type { Middleware } from "./middleware";
export type { QueryBuilder } from "./model";

// 工具
export { createToken, verifyToken } from "./auth/jwt";
export { hash, compare } from "./auth/password";
```

### 应用入口

```ts
const app = thinkts({
  // 自动扫描 routes 目录
  routes: "./src/routes",

  // 数据库 — 三选一
  database: "sqlite:./data.db",
  // database: { type: "mysql", host: "...", ... },
  // database: { type: "postgres", host: "...", ... },

  // JWT 认证
  auth: {
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: "7d",
    },
  },

  // 中间件
  middleware: [
    logger({ format: "json" }),
    cors({ origin: "*" }),
    ratelimit({ max: 100, window: "1m" }),
  ],

  // 自定义错误处理
  onError: (error, ctx) => ({ ... }),

  port: env.PORT ?? 3000,
});

await app.start();
```

---

## 5. 性能架构

### 5.1 连接池

```
┌─────────────────────────────────┐
│          连接池 (per adapter)     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │ C1 │ │ C2 │ │ C3 │ │ C4 │   │  ← 预热 4 连接
│  └────┘ └────┘ └────┘ └────┘   │
│  ┌──────────────────────────┐   │
│  │      等待队列 (FIFO)      │   │  ← 超额请求排队
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

- 连接池大小 = `max(4, cpu_count * 2)`
- 空闲连接 30s 回收
- 最大等待时间 5s → 超时返回 503

### 5.2 查询缓存

```
┌──────────────┐     ┌──────────────────┐
│  Schema 缓存  │────→│  LRU Cache (256)  │
│  (表结构)     │     │  key: table_name  │
└──────────────┘     └──────────────────┘
                            ↓ TTL: 5min
                     自动失效 (DDL 检测)
```

### 5.3 启动优化

```
开发模式 (dev):
  scafold → 按需加载 TS → 热重载监听 → 启动 ~800ms

生产模式 (prod):
  预编译 manifest → 跳过扫描 → SQL 预热连接池 → 启动 ~200ms
```

---

## 6. 安全模型

### 认证流程

```
客户端                      thinkts
  │                           │
  │ POST /auth/login          │
  │ {username, password}      │
  │──────────────────────────→│
  │                           │ 验证凭证
  │                           │ 生成 JWT (HS256)
  │      {token, refresh}     │
  │←──────────────────────────│
  │                           │
  │ GET /api/device/list      │
  │ Authorization: Bearer xxx │
  │──────────────────────────→│
  │                           │ 验证 JWT
  │                           │ 提取 user → ctx.user
  │                           │ ACL 检查: ctx.user.role ∈ model.acl.read
  │                           │ 租户过滤: WHERE tenant_id = ctx.user.tenantId
  │                           │
  │      {data: [...]}        │
  │←──────────────────────────│
```

### ACL 模型

```ts
// 每个 model 定义访问控制
acl: {
  read:  ["superadmin", "admin", "user"],   // 谁能读
  write: ["superadmin", "admin"],           // 谁能写
  delete: ["superadmin"],                    // 谁能删
}

// 行级安全 — 自动注入
// user.role = "user" → 自动添加 WHERE tenant_id = user.tenant_id
// user.role = "superadmin" → 不过滤
```

### SQL 注入防护

所有查询通过参数化执行。用户输入永远不作为 SQL 拼接。
```ts
// 用户代码 — 安全
await DeviceModel.where("name", "like", `%${userInput}%`).select();
// SQL: SELECT * FROM ... WHERE name LIKE ?  参数: ["%userInput%"]

// 不可能写出拼接
await DeviceModel.raw(`SELECT * FROM ... WHERE name = '${userInput}'`); // 不存在 raw 方法
```

---

## 7. 迁移路径 v1 → v2

### 兼容的
- DSL model.json / table.json 格式 → CLI 自动转换为 `.ts`
- 路由路径格式 (`/domain/resource/action`)
- 目录结构 (`src/{domain}/{module}/`)

### 需要改的
| v1 | v2 | 影响 |
|----|-----|------|
| `ctx.think.model(name)` | `Model.find(id)` | 所有 model 调用 |
| `think.service("a.b.c")` | `services.a.b.c()` | 所有跨模块调用 |
| `this.success(data)` | `return { data }` | 所有 handler 返回值 |
| `ControllerBase` | 纯函数 handler | 所有控制器 |
| `new Application(...)` | `thinkts(...)` | 启动代码 |

### 迁移工具
```bash
thinkts migrate v1-to-v2  # 自动转换
```

---

## 8. 目录结构 (v2 项目)

```
myapp/
├── thinkts.config.ts       # 框架配置
├── src/
│   ├── main.ts             # 入口
│   ├── routes/             # 路由 (自动扫描)
│   │   ├── open.ts         # /open/*
│   │   ├── admin.ts        # /admin/*
│   │   └── iotbiz/         # /iotbiz/*
│   │       ├── device.ts
│   │       └── merchant.ts
│   ├── models/             # 数据模型
│   │   ├── user.ts
│   │   └── device.ts
│   ├── services/           # 业务逻辑
│   │   └── billing.ts
│   └── middleware/         # 自定义中间件
│       └── tenant.ts
├── migrations/             # 数据库迁移
├── tests/
└── package.json
```

---

## 总结

thinkts v2 的设计核心是 **类型完整、零动态派发、函数组合**。

| v1 问题 | v2 解决 |
|---------|--------|
| `as any` 遍地 | 类型从头推到尾 |
| `_currentCtx` 全局 | 不可变快照 |
| 5 层继承 | mixin 函数 |
| O(n) 路由 | O(k) Radix |
| JSON + JS 分离 | TypeScript 一体 |
| 字符串服务调用 | 编译时函数绑定 |
