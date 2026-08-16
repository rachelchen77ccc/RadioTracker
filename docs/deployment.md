# RadioTracker：换电脑后部署到 Vercel

最终结构：Vercel 提供固定网址、React 页面和 API；Supabase 提供邮箱登录、Postgres 数据库与封面存储。每位用户使用 Supabase 用户 UUID 隔离数据。

## 需要随身带走的私人文件

GitHub 只有程序代码，不包含本地数据库、猫耳 Cookie和迁移包。换电脑时请通过移动硬盘、隔空投送或自己的私密云盘带走：

- `RadioTracker-private-migration.json`：已有 317 部剧、进度、评分和剧评。
- 如需继续运行本地版，再额外带走 `data/radiotracker.db`。

不要把这两个文件提交到 GitHub。38 张本地封面已经在代码仓库中，部署构建时会自动带上。

## 一、在 Vercel 中创建 Supabase

1. 打开 Vercel 项目的 Storage，选择 Create Database > Supabase，并关联当前项目。Vercel 会自动创建 Supabase 项目并同步数据库、认证和服务端密钥。
2. 从 Vercel 的 Storage 页面进入 Supabase Studio，打开 SQL Editor，完整执行 `supabase/migrations/001_multitenant_foundation.sql`。
3. 在 Authentication 中保留 Email 登录。先完成自己的注册和迁移；如果暂时不准备给别人使用，再关闭公开注册。
4. Marketplace 会自动提供 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`POSTGRES_URL`、`NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，无需复制这些密钥。

密钥只能保存在 Vercel 环境变量里，不能提交 GitHub。

## 二、从 GitHub 导入 Vercel

1. 登录 Vercel，选择 Add New > Project，导入 `rachelchen77ccc/RadioTracker`。
2. 如果 PR 还没有合并到 `main`，将 Production Branch 暂时选择 `codex/year-report-visual-refresh`；合并后再切回 `main`。
3. Vercel 会读取 `vercel.json`，执行 `npm run build:vercel`，不需要手填输出目录。
4. Supabase Marketplace 变量会自动同步；只需额外添加下面这一项，并勾选 Production、Preview 和 Development：

| 名称 | 值 |
| --- | --- |
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
# GitHub Pages 个人版（当前使用）

网页由 `.github/workflows/pages.yml` 发布到：

`https://rachelchen77ccc.github.io/RadioTracker/`

- 页面、路由和样式由 GitHub Pages 托管。
- 剧目、收听状态、听完日期、剧评和日记仍保存在 Supabase，并受账号登录和 RLS 保护。
- 浏览器直接读取、编辑自己的 Supabase 数据，日常使用不经过 Vercel。
- `.github/workflows/missevan-sync.yml` 每 6 小时同步一次猫耳，并把封面缓存到 Supabase Storage。
- GitHub 仓库和构建产物中不保存猫耳 Cookie、数据库密码、service role key 或加密密钥。

GitHub 仓库需要配置一个 Variable：`VITE_SUPABASE_URL`，以及五个 Secrets：
`VITE_SUPABASE_ANON_KEY`、`DATABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、
`CREDENTIAL_ENCRYPTION_KEY`、`OWNER_USER_ID`。
