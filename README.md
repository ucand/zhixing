# 知行人生答卷

基于 OpenDesign 项目“知行”与产品需求文档实现的 React + TypeScript 全栈应用。产品以“笔记积累 → 提交材料 → 生成答卷 → 执行计分 → 补充笔记 → 再次作答”为完整闭环。

## 运行

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
pnpm preview
```

## Vercel + Neon / Supabase 部署

项目已提供 `vercel.json` 和 `api/index.ts`，可在 Vercel 直接部署：Vite 生成静态前端，Express API 作为 Serverless Function 运行。推荐使用 Neon 或 Supabase 的 pooled connection string 配置 `DATABASE_URL`。

在 Vercel 项目环境变量中配置：

- `DATABASE_URL`：Neon/Supabase 的连接池地址
- `ZHIHU_ACCESS_SECRET`：知乎开放平台 Access Secret
- `ZHIHU_APP_ID`、`ZHIHU_APP_KEY`：知乎 OAuth 应用凭证，仅服务端使用
- `ZHIHU_OAUTH_REDIRECT_URI`：已在知乎开放平台登记的 OAuth 回调地址
- `ZHIHU_OAUTH_SESSION_SECRET`：至少 32 位随机字符串，用于会话哈希和 Token 加密
- `VERCEL=1`：Vercel 会自动注入，可不手动配置

首次部署前，在目标 PostgreSQL 数据库依次执行 `db/migrations/001_initial.sql`、`db/migrations/002_note_color.sql` 和 `db/migrations/003_zhihu_oauth.sql`。生产环境不要开放 `POST /api/state/migrate`，并应逐步将业务接口改为按登录用户做 `user_id` 数据隔离。

Vercel 部署步骤：

1. 将本项目推送到 GitHub 的 `zhixing` 仓库。
2. 在 Vercel 导入该仓库，Framework 选择 Vite，Build Command 使用 `pnpm run build`，Output Directory 使用 `dist`。
3. 配置上述环境变量，重新部署。
4. 使用 `/api/health` 检查 API 与数据库连接。

注意：知乎直答可能需要较长时间；Vercel 当前函数配置为 60 秒上限。若实际生成时间超过平台限制，应改为异步任务队列，或将 API 迁移到支持长连接的服务。

`pnpm dev` 会同时启动前端 `5173` 端口与 API `8787` 端口。

Windows 下 API 开发命令会先编译服务端，再启动 Node 服务。修改服务端源码后重新执行 `pnpm dev` 即可刷新。

不要使用 VS Code Live Server、直接打开 `index.html`，或只运行 `pnpm dev:web`；这些方式没有知乎 API。生产预览请先执行 `pnpm build`，然后运行 `pnpm start`，浏览器打开 `http://127.0.0.1:8787`。该地址由同一个 Express 服务托管前端和 API，不会出现 `/api` 被误当成 HTML 页面的情况。

## 知乎开放平台

- `GET /api/zhihu/search?q=关键词` 调用知乎站内搜索并返回真实内容摘要与溯源链接。
- `POST /api/papers/generate` 调用知乎直答 `zhida-thinking-1p5` 生成结构化答卷。
- 笔记本、笔记、答卷和任务仅保存在浏览器 `localStorage`，不通过 API 读写 PostgreSQL。
- `/api/state`、`/api/notebooks`、`/api/notes`、`/api/papers` 和 `/api/tasks` 等历史业务接口已停用并返回 `LOCAL_ONLY`。
- `POST/PATCH/DELETE /api/notebooks`、`POST/PATCH/DELETE /api/notes` 提供笔记本与笔记 CRUD。
- `DELETE /api/papers/:id` 删除答卷，`PATCH /api/tasks/:id` 更新答卷任务完成状态。
- 本地开发默认通过官方知乎 CLI 读取系统凭据库，不需要把 Access Secret 写进项目。
- 部署环境通过 `ZHIHU_ACCESS_SECRET` 由后端直连知乎 HTTP API；密钥不得发送到浏览器。
- 搜索带 5 分钟内存缓存，生成结果经过 Zod 校验，失败时前端明确提示并使用本地规则引擎降级。

环境变量参考 `.env.example`。不要将真实密钥提交到代码仓库。

## PostgreSQL

初始数据模型位于 `db/migrations/001_initial.sql`，覆盖用户、笔记本、笔记、答卷版本、阶段、任务、来源关联和 API 缓存。配置 `DATABASE_URL` 后，API 健康检查会验证数据库连接。前端启动时会优先探测数据库：远端已有数据时加载远端状态，远端为空时迁移当前 localStorage 数据；数据库不可用时保留 localStorage 离线模式。迁移会将旧的字符串 ID 映射为 UUID，并在事务失败时自动回滚。

当前本机 PostgreSQL 服务已运行且 5432 端口可连接，但 `.env` 中的数据库密码认证失败；修正 `DATABASE_URL` 后即可验收真实 CRUD 和迁移。

## 已实现

- 笔记本创建与切换
- 我的想法、摘录、限制条件、我的尝试四类笔记
- 笔记新增、编辑、删除、勾选与浏览器本地持久化
- 知乎摘录搜索、选择、划线、入库的三步演示流程
- 多条笔记提交并生成结构化人生答卷
- 题目、已知条件、参考依据、四阶段行动、得分点与阅卷评语
- 阶段任务勾选与实时计分
- 一诊、二诊等历史版本记录和重新作答
- 桌面、移动端响应式布局与打印样式

## 工程结构

- `src/App.tsx`：页面组件和交互流程
- `src/types.ts`：领域类型
- `src/data.ts`：初始数据、标签配置和本地答卷生成器
- `src/api.ts`：前端知乎搜索与答卷生成客户端
- `src/storage.ts`：过渡期 localStorage 持久化
- `src/styles.css`：OpenDesign 视觉还原、响应式和打印样式
- `server/index.ts`：Express API 入口
- `server/zhihu.ts`：官方 CLI / HTTP 双适配器、缓存和 AI 解析
- `server/contracts.ts`：请求与 AI 输出运行时校验
- `db/migrations/001_initial.sql`：PostgreSQL 初始迁移

知乎搜索和答卷生成均已接入官方开放平台。服务不可用、鉴权失败、额度受限或 AI 输出结构异常时，应用会给出可见提示；答卷生成会降级到本地规则引擎，保证核心演示不中断。
