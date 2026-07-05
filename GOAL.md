# ThinkTS — Grand Goal

## 终局：thinkts-saas 可组装 SaaS 平台

```
                         thinkts-saas (SaaS 管理平台)
                    ┌──────────┼──────────┐
                    │          │          │
               iotbiz      edu-saas    mall-saas  ...  ← 组装出的产品
              (设备支付)    (在线教育)   (商城)
                    │          │          │
                    └──────────┼──────────┘
                               │
                     SaaS 通用插件池
          ┌────────┬────────┬────────┬────────┐
       tenant  identity permission  trade  payment ...
```

## 三层产品

| 产品 | 定位 | 用户 |
|------|------|------|
| **thinkts** | 服务器框架 | 开发者 |
| **thinkts-cli** | 脚手架 + 插件组装 | 开发者 |
| **thinkts-saas** | SaaS 管理平台 + 插件池 + 后台管理 | SaaS 运营商 |

## thinkts-saas 是什么

一个**可运行的项目**，包含：

1. **SaaS 管理后台** — 多租户管理、租户开通、套餐配置、插件启用/禁用
2. **通用插件池** — 所有 SaaS 都需要的模块，每个是独立插件
3. **产品组装能力** — CLI 从插件池勾选，生成具体产品（如 iotbiz）
4. **第一个产品** — iotbiz（共享设备支付平台），验证整个体系

### SaaS 管理后台功能

```
thinkts-saas/admin/
├── 租户管理     ← 开通/停用/配置租户
├── 套餐管理     ← 基础版/标准版/企业版，每版包含不同插件组合
├── 插件市场     ← 查看已安装插件，启用/禁用插件
├── 产品管理     ← 从插件组合生成产品实例
└── 系统监控     ← 租户用量、API 调用量、错误率
```

### 插件 Monorepo（仿 NocoBase packages/ 结构）

所有插件在一个 monorepo 里，每个插件是 `packages/` 下的独立目录：

```
thinkts-saas/                       ← monorepo 根
├── package.json                     ← workspaces: ["packages/*"]
├── thinkts.config.ts                ← 全局配置
├── admin/                           ← SaaS 管理后台
│   ├── pages/
│   │   ├── tenants/                 ← 租户管理
│   │   ├── packages/                ← 套餐管理
│   │   ├── plugins/                 ← 插件市场
│   │   └── products/                ← 产品管理
│   └── layout.tsx
├── packages/                        ← 通用插件池（每个 = 独立可复用模块）
│   ├── tenant/
│   │   ├── package.json             ← { "name": "@thinkts/tenant", "version": "1.0.0" }
│   │   ├── plugin.ts                ← 自声明
│   │   ├── model.ts
│   │   ├── service.ts
│   │   ├── migrations/
│   │   └── admin/                   ← 插件自带后台页面
│   ├── identity/
│   ├── permission/
│   ├── trade/
│   ├── payment/
│   ├── promote/
│   ├── cms/
│   ├── dashboard/
│   ├── event/
│   ├── workflow/
│   └── audit/
├── apps/                            ← 组装出的产品（引用 packages/ 下的插件）
│   └── iotbiz/                      ← 第一个产品
│       ├── thinkts.config.ts        ← plugins: ["@thinkts/tenant", "@thinkts/identity", ...]
│       ├── src/iotbiz/              ← iotbiz 特有业务模块
│       └── admin/                   ← iotbiz 特有后台页面
├── bun.lock
└── README.md
```

### iotbiz — 第一个组装产品

iotbiz 不包含通用插件代码。它**引用** thinkts-saas 的插件，再加上自己的业务模块：

```
iotbiz/
├── thinkts.config.ts    ← 声明依赖的插件组合
│   plugins: ["tenant","identity","permission","trade","payment","promote","dashboard","event"]
│
├── src/
│   └── iotbiz/          ← iotbiz 自己的业务模块（不是通用插件）
│       ├── device/      ← 设备管理（只有设备类 SaaS 需要）
│       ├── merchant/    ← 商家管理
│       ├── session/     ← 设备会话
│       ├── revenue/     ← 收益分账
│       └── campaign/    ← 设备营销
│
└── admin/               ← 后台（继承 thinkts-saas 后台 + iotbiz 特有页面）
```

### 插件依赖拓扑

```
                         tenant
                           │
                       identity
                        │     │
                  ┌─────┘     └─────┐
                  ▼                 ▼
              permission          trade
                  │                 │
                  │            payment
                  │                 │
                  └────────┬────────┘
                           ▼
                       promote
                        │     │
                  ┌─────┘     └─────┐
                  ▼                 ▼
              dashboard           cms
                  │
              workflow
                  │
               event
                  │
               audit
```

### 分阶段路线图

| 阶段 | 目标 | 产物 |
|------|------|------|
| 1 | thinkts 框架稳定，P0 修复，路由+DSL 完善 | thinkts v0.2 |
| 2 | CLI 模板完善，可生成项目，可 DB 反向生成 | thinkts-cli v0.2 |
| 3 | 插件化：plugin.ts 自声明 + 拓扑加载 | thinkts v0.3 |
| 4 | 从 iotbiz 拆出通用模块 → 通用插件池 | thinkts-saas v0.1 |
| 5 | SaaS 管理后台：租户管理、套餐、插件管理 | thinkts-saas v0.2 |
| 6 | CLI compose 命令：勾选插件 → 生成产品 | thinkts-cli v0.3 |
| 7 | iotbiz 用 compose 重新生成，只保留业务模块 | iotbiz v2.0 |
