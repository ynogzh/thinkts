# ThinkTS — Grand Goal

## 终极目标：可组合 SaaS 底座

thinkts 的最终形态不是「一个框架」，而是**一个 SaaS 组装平台**。

### 核心能力

```
thinktsaas（插件仓库）
├── @thinkts/tenant          ← 租户管理
├── @thinkts/identity        ← 用户/登录
├── @thinkts/permission      ← 角色/权限
├── @thinkts/trade           ← 订单
├── @thinkts/payment         ← 支付
├── @thinkts/promote         ← 优惠券/代理
├── @thinkts/cms             ← 内容管理
├── @thinkts/device          ← 设备管理
├── @thinkts/workflow        ← 工作流
├── @thinkts/audit           ← 审计日志
└── ...更多插件

thinkts-cli（组装工具）
→ 勾选插件 → 生成项目 → 插件全部挂好 → 写业务差异逻辑
```

### 使用场景

```
需求：共享设备支付平台
  ↓
选择: tenant + identity + permission + trade + payment + device + promote
  ↓
thinkts compose iotbiz --plugins tenant,identity,permission,trade,payment,device,promote
  ↓
生成 iotbiz 项目，插件全部就位，直接写设备业务逻辑

需求：在线教育 SaaS
  ↓
选择: tenant + identity + permission + trade + payment + cms
  ↓
thinkts compose edu-saas --plugins tenant,identity,permission,trade,payment,cms
  ↓
生成 edu-saas 项目，直接写选课逻辑
```

### 插件规范

每个插件 = 一个自声明的目录：

```
@thinkts/device/
├── plugin.ts           ← 自声明：name, version, depends, 注册 model/service
├── model.ts            ← 数据模型
├── service.ts          ← 业务钩子 + API 路由
├── migrations/         ← 建表 SQL
└── admin/              ← 后台页面（可选）
    ├── pages/
    └── menu.ts
```

```ts
// plugin.ts
export default {
  name: "@thinkts/device",
  version: "1.0.0",
  depends: ["@thinkts/tenant", "@thinkts/identity"],

  async load(ctx) {
    ctx.model(await import("./model"));
    ctx.service(await import("./service"));
  },
};
```

### 插件仓库

```
thinkts-plugins/
├── packages/
│   ├── tenant/
│   ├── identity/
│   ├── permission/
│   ├── trade/
│   ├── payment/
│   ├── promote/
│   ├── device/
│   ├── cms/
│   └── ...
├── thinkts.config.ts    ← 插件清单
└── README.md
```

### 插件依赖关系

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
           device              cms
```

### 分阶段路线图

| 阶段 | 目标 | 状态 |
|------|------|------|
| 1 | thinkts 框架稳定，DSL 支持完善 | ✅ 进行中 |
| 2 | CLI 可生成项目，CLI 有模板 | ✅ 进行中 |
| 3 | 插件化：plugin.ts 自声明 + 拓扑加载 | 🔲 待实现 |
| 4 | 从 iotbiz 中拆出通用模块作为插件 | 🔲 待实现 |
| 5 | thinkts-cli `compose` 命令：勾选插件生成项目 | 🔲 待实现 |
| 6 | 插件仓库独立管理，版本化，可共享 | 🔲 未来 |
