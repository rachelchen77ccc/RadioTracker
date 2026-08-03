# RadioTracker：换电脑后部署到 Vercel

最终结构：Vercel 提供固定网址、React 页面和 API；Supabase 提供邮箱登录、Postgres 数据库与封面存储。每位用户使用 Supabase 用户 UUID 隔离数据。

## 需要随身带走的私人文件

GitHub 只有程序代码，不包含本地数据库、猫耳 Cookie和迁移包。换电脑时请通过移动硬盘、隔空投送或自己的私密云盘带走：

- `RadioTracker-private-migration.json`：已有 317 部剧、进度、评分和剧评。
- 如需继续运行本地版，再额外带走 `data/radiotracker.db`。

不要把这两个文件提交到 GitHub。38 张本地封面已经在代码仓库中，部署构建时会自动带上。

## 一、准备 Supabase

1. 创建一个新的 Supabase 项目。
2. 打开 SQL Editor，完整执行 `supabase/migrations/001_multitenant_foundation.sql`。
3. 在 Authentication 中保留 Email 登录。先完成自己的注册和迁移；如果暂时不准备给别人使用，再关闭公开注册。
4. 在 Project Settings / API 中取得 Project URL、anon/publishable key、service role key。
5. 在 Connect 中取得 Postgres pooler 连接串，作为 `DATABASE_URL`。

`service role key` 和数据库连接串只能填写在 Vercel 环境变量里，不能放到任何 `VITE_` 变量，也不能提交 GitHub。

## 二、从 GitHub 导入 Vercel

1. 登录 Vercel，选择 Add New > Project，导入 `rachelchen77ccc/RadioTracker`。
2. 如果 PR 还没有合并到 `main`，将 Production Branch 暂时选择 `codex/year-report-visual-refresh`；合并后再切回 `main`。
3. Vercel 会读取 `vercel.json`，执行 `npm run build:vercel`，不需要手填输出目录。
4. 添加以下环境变量，并勾选 Production、Preview 和 Development：

| 名称 | 值 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `SUPABASE_URL` | 同一个 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | Supabase pooler 连接串 |
| `CREDENTIAL_ENCRYPTION_KEY` | 32 字节 Base64 随机密钥 |

生成加密密钥：

```bash
openssl rand -base64 32
```

5. 点击 Deploy。Vercel 会生成形如 `https://radio-tracker-xxx.vercel.app` 的固定地址。
6. 将这个地址填写到 Supabase Authentication 的 Site URL 和 Redirect URLs。

## 三、迁移已有档案

1. 打开部署网址，创建并登录自己的账号。
2. 访问 `https://你的地址.vercel.app/cloud-migration`。
3. 选择 `RadioTracker-private-migration.json`，点击“开始迁移”。
4. 完成后核对：317 部剧、660 位 CV、6,258 条 CV 关联和 38 张本地封面记录。

迁移入口会把数据归属到当前登录账号，不读取迁移包里的占位用户 ID；同一个账号默认只能迁移一次。

## 四、猫耳自动更新

在侧栏点击“自动更新”，第一次粘贴猫耳 Cookie。Cookie 会在 Vercel 服务端使用 AES-256-GCM 加密后存进 Supabase；接口只返回“是否已保存”，不会返回 Cookie 原文。

点击更新后，Vercel Function 会在后台拉取猫耳已购和追剧并比较增加、减少，再补详情。配置的最长执行时间是 300 秒；如果需要补的详情超过 40 部，本次完成后再次点击会继续补齐。

## 五、以后给别人使用

在 Supabase Authentication 打开注册后，把同一个 Vercel 链接发给别人即可。每位新用户注册后从空档案开始，保存自己的猫耳登录信息并同步；数据库查询和写入始终使用其 Supabase 用户 UUID。

## 部署前检查

```bash
npm install
npm test
npm run build:vercel
```

构建会把 GitHub 中的 38 张本地封面复制到 Vercel 静态资源目录。数据库、迁移包、环境变量和猫耳登录信息都不会进入部署源码。
