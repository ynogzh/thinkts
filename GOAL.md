# thinkts-saas

> 可组装 SaaS 平台。一个 monorepo，勾选插件 → 生成产品。

## 架构

```
thinkts-saas/                       ← 一个 git 仓库
├── packages/
│   ├── thinkts/                    ← 框架引擎
│   ├── thinkts-cli/                ← CLI 工具
│   ├── tenant/                     ← 插件：租户
│   ├── identity/                   ← 插件：用户/登录
│   ├── permission/                 ← 插件：权限
│   ├── trade/                      ← 插件：订单
│   ├── payment/                    ← 插件：支付
│   ├── promote/                    ← 插件：营销
│   ├── cms/                        ← 插件：内容
│   ├── dashboard/                  ← 插件：看板
│   ├── event/                      ← 插件：事件
│   ├── workflow/                   ← 插件：工作流
│   └── audit/                      ← 插件：审计
├── apps/
│   └── iotbiz/                     ← 产品：共享设备支付
├── admin/                          ← SaaS 管理后台
└── bun.lock
```

## 核心设计

- **插件自声明**：每个插件有 `plugin.ts`，自己声明 name、depends、load()
- **扫描下沉到插件**：框架提供 `ctx.scanModels("./models")`，插件扫自己的目录。框架不扫全量 src/
- **thinkts + cli 服务 thinkts-saas**：平台是产品，框架和工具可以因平台需求修改
- **插件必须 SaaS 通用**：不能有业务特定逻辑。iotbiz 的特有模块（device/merchant/session）在 `apps/iotbiz/src/` 里，不进插件池

## 阶段

| # | 目标 | 状态 |
|---|------|------|
| 1 | thinkts 框架稳定 + CLI 可用 | ✅ |
| 2 | 插件化：plugin.ts 自声明 + 拓扑加载 | 🔲 |
| 3 | 从 iotbiz 拆通用模块 → 插件池 | 🔲 |
| 4 | SaaS 管理后台 | 🔲 |
| 5 | CLI compose：勾选插件 → 生成产品 | 🔲 |
