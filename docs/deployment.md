# RadioTracker 云端部署与数据迁移

目标是让原有本地记录完整保留在第一个账号下，以后每位新用户只看到自己的已购、收藏、收听状态、评分和剧评。

## 已完成的部署基础

- 云端数据拆成公共剧目资料与私人用户记录，避免重复抓取资料，也避免用户之间互相看到状态。
- 所有私人表启用了 Supabase Row Level Security，只允许当前登录用户访问自己的数据。
- 猫耳 Cookie 只允许服务端读取，使用 AES-256-GCM 加密后再保存；浏览器和其他用户都拿不到明文。
- 本地 SQLite 迁移工具会生成带校验和的私密迁移包，并明确排除 `.missevan-session.json`。
- 本地模式保持不变，在云端密钥未配置前仍可照常使用。

## 一、创建 Supabase 项目

1. 创建一个 Supabase 项目并记下 Project URL、anon key、service role key 和数据库连接串。
2. 在 Authentication 中开启邮箱登录；第一阶段只给自己创建账号，确认稳定后再开放注册。
3. 在 SQL Editor 执行 `supabase/migrations/001_multitenant_foundation.sql`。
4. 登录一次后，到 Authentication > Users 复制自己的 UUID。
5. 将该 UUID 作为 `MIGRATION_OWNER_ID`。service role key、数据库密码和加密密钥只能放在部署平台的服务端环境变量中。

生成加密密钥：

```bash
openssl rand -base64 32
```

## 二、验证并导出本地记录

先做不上传的本地演练：

```bash
npm run migration:cloud:dry
```

默认使用占位用户 UUID，生成 `data/cloud-migration-dry-run.json`。该文件包含私人收听记录和剧评，已被 Git 忽略，不会上传 GitHub；猫耳 Cookie 不在其中。

Supabase 账号创建后，使用真实 UUID 再导出：

```bash
npm run migration:cloud:dry -- --owner-id YOUR_AUTH_USER_UUID --out data/cloud-migration-owner.json
```

迁移包会检查剧目、CV、重刷计划和同步记录之间的关联，并为每张本地封面生成校验和与目标 Storage 路径。正式写入 Supabase 前应再次核对输出数量。

## 三、部署 Render

建议创建两个服务：

- Web Service：React 页面和 API，构建命令 `npm ci && npm run build`，启动命令 `npm start`。
- Background Worker：处理每个用户的猫耳同步任务。点击“自动更新”后 Web Service 只创建任务，Worker 按用户读取加密 Cookie、抓取已购和追剧、写回差异。

Web Service 环境变量以 `.env.example` 为准。`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL`、`CREDENTIAL_ENCRYPTION_KEY` 不能出现在任何 `VITE_` 变量里。

## 四、正式切换顺序

1. 云端先保持私有，只允许自己的账号。
2. 导入本地迁移包，核对总数、已购、收藏、状态、进度、评分、剧评和封面。
3. 将同步 API 改为按登录用户创建后台任务，连续测试增加与减少两种变化。
4. 做一次数据库备份并保留原始 `data/radiotracker.db` 的离线副本。
5. 最后才开放新用户注册。新用户登录后从空的私人记录开始，通过猫耳同步建立自己的已购和收藏。

## 尚未启用的部分

当前提交是安全迁移基础，不会擅自把本地数据上传到第三方。完成 Supabase 项目创建并拿到自己的用户 UUID 后，下一阶段才会接入登录页面、云端 API、正式导入和 Render 后台同步 Worker。
