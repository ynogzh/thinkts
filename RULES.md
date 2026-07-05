# ThinkTS Project Rules
## 0. 深度思考 — 每个变更前必须回答的三个问题

### 0.1 问题是什么？
- 用一句话描述用户看到/遇到的**实际问题**
- 不能是"代码不够优雅"、"继承太深"、"可以用 xx 模式" — 这些不是问题
- 如果是自己推测的问题，必须先在 iotbiz 中复现确认

### 0.2 这个问题造成了什么后果？
- 如果没有后果 → 不改
- 如果是理论上的后果但从未实际发生 → 不改
- 如果是性能问题 → 必须有 benchmark 数据
- 如果是 DX 问题 → 必须有具体场景描述

### 0.3 最简单的修复是什么？
- 3 行代码能解决吗？优先 3 行
- 需要新增文件吗？优先不改结构
- 能在一个模块内解决吗？优先不动其他模块
- 用户的调用方式会变吗？变了就再想想

**反例**：看到 5 层继承 → "应该用 mixin" → 新增 5 个文件 → 用户调用方式全变
**正例**：`_currentCtx` 可变全局 → 请求可能读错上下文 → 删掉 `_currentCtx`，调用方传 `_aclCtx`

---


## 1. 代码规范

### 文件长度
- 每个源文件 MUST 不超过 200 行
- 超过的 MUST 按职责拆分为独立模块
- 拆分的模块 MUST 放在同一目录下，用清晰的命名表达职责

### 面向对象
- 用 `class` 表达有状态的对象（Model、Controller、Service）
- 用 `interface` / `type` 定义数据形状
- 用纯函数处理无状态的工具逻辑（schema、utils、helpers）
- `private` / `protected` 方法 MUST 有明确的访问控制理由
- AVOID `as unknown as` 和 `as any` — 如果必须用，意味着接口设计有问题

### TypeScript 类型
- 公共 API MUST 有明确的类型签名，不允许 `any`
- 函数返回值 MUST 显式标注，不依赖类型推断
- `Record<string, unknown>` 仅用于无法预知结构的动态数据（如用户输入）
- DSL 层的数据结构 MUST 用 `interface` 定义，禁止用 `Record<string, unknown>` 传递

### 模块导入
- 外部导入在前，内部导入在后
- 类型导入用 `import type`，避免运行时加载
- 禁止循环引用 — 如果出现，拆分公共类型到独立文件

## 2. Git 提交规范

### 提交粒度
- 每个逻辑变更 MUST 独立提交
- 一个提交只做一件事：fix、feat、refactor、chore 不混在一起
- 提交信息格式：`<type>(<scope>): <描述>`
  - type: feat / fix / refactor / perf / chore / test
  - scope: thinkts / cli / iotbiz / admin / api
  - 描述用英文，简洁说明做了什么、为什么

### 提交时机
- 写完一个功能点并验证通过后立即提交
- 不要攒多个变更一起提交
- 修复 bug 时，先提交复现测试，再提交修复
- 重构时，先提交准备工作（如添加测试），再提交重构本身

## 3. 验证规范

### 测试
- 每个 `fix` 提交 SHOULD 包含对应的测试
- 每个 `feat` 提交 MUST 包含测试（除非是纯模板/配置变更）
- 修改框架代码后 MUST 运行 `bun test` 全量测试
- CI 不过的代码 MUST NOT push

### 端到端验证
- 修改 thinkts 框架后 MUST 验证 iotbiz API 是否正常工作
- 修改 CLI 模板后 MUST 运行 `thinkts new test-app` 验证脚手架可用
- 修改 admin 模板后 MUST 运行 `npx next build` 验证编译通过

## 4. 架构决策

### 默认原则
- 优先使用 Bun 原生 API（`Bun.file`, `Bun.sql`, `Bun.serve`）
- 新增依赖 MUST 有充分理由 — 框架依赖越少越好
- 配置优先于约定，显式优先于隐式
- 模板中的代码是用户的第一印象 — MUST 简洁、清晰、有注释

### 兼容策略
- 开发期（1.0 之前）不需要向后兼容，可以直接修改接口
- BUT: 修改公共 API 前 MUST 确认所有调用方已适配
- 废弃接口 MUST NOT 保留 shim — 直接删除

### 命名
- 框架导出用 `PascalCase`：`BaseController`, `ThinkKernel`
- 配置/常量用 `UPPER_SNAKE_CASE`：`ROOT_PATH`, `JWT_SECRET`
- 目录用 `snake_case`，和数据库表名保持一致
- URL 路径用 kebab-case 风格的目录分隔：`/iotbiz/device/category`

## 5. 模板开发

### CLI 模板
- `thinkts-cli/templates/` 是用户项目的起点
- 模板中的代码 MUST 比框架代码更注重规范（用户会模仿）
- 每个模板新增后 MUST 在 `thinkts new test-app` 中验证
- 模板中的 `.env` MUST 只包含占位值，不能有真实凭证

### Admin 模板
- admin 模板基于 shadcnblocks，组件统计一风格
- admin 中不能有业务特定的硬编码数据
- 所有 admin 页面 MUST 通过配置驱动（catalog / menu / resource）

## 6. 项目间协同

### 依赖关系
```
iotbiz → thinkts (framework)
iotbiz → thinkts-cli (generated DSL)
```

- 修改 thinkts 后，先在 iotbiz 中验证，再提交 thinkts
- 修改 CLI 生成逻辑后，先在 iotbiz 中重新生成并对比差异

### 版本管理
- thinkts 和 thinkts-cli 独立发版
- iotbiz 是应用项目，不参与框架发版
- 模板改进属于 thinkts-cli 的范畴

## 7. 性能

- AVOID 不必要的 `Object.entries` 循环 — 用 `for...in` 或直接属性访问
- 框架启动路径 AVOID 同步 `readFileSync` 大量文件 — 按需加载
- Model 层 MUST 用连接池复用 DB 连接，禁止每次操作创建新连接
- Admin 的 Next.js 构建 SHOULD 生成静态页面（SSG）而非全量 SSR
