# ThinkTS 迭代方向

## 定位

ThinkTS 是一个 **Bun 原生的 TypeScript 全栈框架**，目标用户是中小团队快速构建 SaaS 后台。
对标：NestJS（架构思想）、Hono（性能）、Laravel（开发体验）、Directus（无代码后台）。

## 三层产品

| 产品 | 定位 | 对标 |
|------|------|------|
| **thinkts** | 服务器框架 | NestJS + Hono |
| **thinkts-cli** | 脚手架 + 代码生成 | `npx create-next-app` + `prisma generate` |
| **iotbiz** | 参考应用（不发布） | — |

## thinkts 框架 — 迭代方向

### 1. 类型安全（P0）
当前：DSL 是 JSON，service 调用是字符串，model 返回 `Record<string, unknown>`
目标：
- `think.service("identity.auth.login")` → 编译时检查 service 是否存在
- `model.where({ status: "enabled" }).select()` → 返回类型包含实际字段
- `api.json` 的路由 handler 有类型推导

### 2. 开发体验（P0）
当前：错误堆栈混乱，调试困难，日志零散
目标：
- 请求级别的结构化日志（traceId 贯穿全部调用链）
- 友好的错误页面（开发模式显示 SQL、调用栈、上下文）
- 热重载：改 model.json / service.ts 不需要重启
- `bun dev` 一键启动，零配置

### 3. 性能（P1）
当前：启动时 2 次目录扫描，路由表全量缓存
目标：
- 生产模式 manifest.json 预编译 → 零扫描启动
- DSL model.json 编译为 Bun native module → 跳过 JSON.parse
- Admin SSR 改为 ISR/SSG

### 4. 数据库抽象（P1）
当前：只支持 MySQL + SQLite，通过 Bun.sql() 直连
目标：
- PostgreSQL 支持
- 迁移工具（类似 prisma migrate）
- 数据库视图自动映射为 DSL model
- 字段级加密（敏感字段自动加解密）

### 5. 安全（P1）
当前：JWT + ACL + 租户隔离
目标：
- RBAC 权限控制台（可视化配置）
- API 限流（token bucket，按租户/用户/IP）
- 审计日志自动记录（DDL 感知，字段变更 diff）
- CSRF / CORS 默认安全配置

## thinkts-cli — 迭代方向

### 1. 零配置启动（P0）
当前：需要手动配置 .env、adapter、middleware
目标：
- `thinkts new myapp` → `cd myapp && bun dev` → 浏览器看到登录页
- SQLite 作为默认数据库（零依赖启动）
- 内置 admin 账号（admin/admin），首次登录强制改密码

### 2. 代码生成质量（P0）
当前：生成 JS DSL 文件，类型注解有限
目标：
- 全部生成 TypeScript
- model 生成包含完整的 CRUD 类型
- service 生成包含常用查询（findByXxx, listActive 等）
- admin 页面自动生成（根据 model.json 推断表单/表格）

### 3. 数据库反向工程（P1）
当前：从 MySQL 读 INFORMATION_SCHEMA
目标：
- 支持从已有数据库一键生成完整后台
- 识别外键关系 → 自动生成关联查询
- 识别 ENUM → 自动生成下拉选择
- 支持 PostgreSQL / SQLite 反向工程

### 4. 部署（P1）
目标：
- `thinkts deploy` → 一键部署到 VPS / Docker
- 内置 Dockerfile 模板
- 内置 GitHub Actions CI 模板
- `thinkts env` → 环境变量管理（开发/测试/生产）

## iotbiz 参考应用 — 迭代方向

作为 thinkts 的 "证明它可以" 的参考：
- 完整覆盖共享设备支付场景（娃娃机、按摩椅、售货机）
- Admin 体验 > 直接数据库操作
- 所有功能通过 catalog 配置实现（不写死页面）
- 每个 iotbiz 迭代暴露出 framework 的不足 → 反哺框架

## 不做的事

- 不做 GraphQL（专注 REST + RPC）
- 不做微服务框架（专注单体 SaaS）
- 不做前端框架（专注后端，admin 用 Next.js）
- 不做可视化低代码（代码生成 > 拖拽配置）
- 不做 WebSocket 优先（HTTP + 轮询为主）
