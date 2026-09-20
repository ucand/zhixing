# 知行人生答卷

基于 OpenDesign 项目「知行」实现的 React + TypeScript 全栈应用。产品闭环是：笔记积累 → 勾选材料 → 生成答卷 → 勾选任务计分 → 补充笔记 → 再次作答。

## 运行

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动前端 `5173` 与 API `8787`；Vite 把 `/api` 代理到本地 API。不要用 Live Server、直接打开 `index.html`，或只跑 `pnpm dev:web`，这些方式没有知乎搜索与直答。

生产构建与本机预览：

```bash
pnpm build
pnpm start
```

浏览器打开 `http://127.0.0.1:8787`。该地址由同一个 Express 服务托管静态前端和 API。

## 业务数据存储

**笔记本、笔记、答卷、任务完成状态只保存在当前浏览器的 `localStorage`，不写入 PostgreSQL，也不走业务 CRUD API。** 换设备、换浏览器、无痕窗口、清理站点数据后，这些内容不会自动带回。知乎登录只用于展示账号身份，不会把笔记或答卷同步到服务端。

### 前端怎么存

`src/storage.ts` 把完整 `AppState` 序列化成一条 JSON：

| 项 | 说明 |
| --- | --- |
| 键名 | `zhixing-app-v1:anonymous`（兼容旧键 `zhixing-app-v1`） |
| 内容 | `{ notebooks, notes, papers }` |
| 写入时机 | `App` 中 `state` 每次变化都会 `saveState` |
| 首次打开 | 本地没有有效 JSON 时，使用 `src/data.ts` 的 `initialState`（职业/学习/生活/健康四个示例本子和几条演示笔记） |

`AppState` 结构见 `src/types.ts`：

- `notebooks`：本子 id、名称、颜色
- `notes`：所属本子、标签（想法 / 摘录 / 限制 / 尝试）、正文、勾选、可选知乎来源
- `papers`：题目、已知条件、参考依据、四阶段任务与完成标记、得分点、阅卷评语、引用的笔记 id

创建/编辑/删除笔记本与笔记、提交答卷、勾选任务、删除答卷，都是在内存里改这份状态，再写回 `localStorage`。服务端不参与读写。

`storage.ts` 预留了按 `scope` 分桶的键名，但当前页面始终用匿名桶，**登录知乎不会切换本地数据分区**。

### 服务端不存什么

以下路径已关闭，统一返回 `410` / `LOCAL_ONLY`：

- `/api/state`、`/api/state/migrate`
- `/api/notebooks`、`/api/notes`、`/api/tasks`
- `/api/papers` 的增删改查（`POST /api/papers/generate` 除外）

`src/api.ts` 和 `server/repository.ts` 里仍有历史远程 CRUD / 本地导入 PostgreSQL 的代码，**当前路由没有挂载，前端主流程也不会调用**。`db/migrations/001_initial.sql`、`002_note_color.sql` 里的 `notebook` / `note` / `paper` / `paper_stage` / `paper_task` / `paper_note` 表是早期设计残留，线上业务不再写入。

### 答卷生成与本地的关系

`POST /api/papers/generate` 只把勾选笔记发给知乎直答，返回结构化答卷 JSON。前端 `hydratePaper` 补上 id、笔记本、笔记引用后，把整份答卷追加进 `AppState` 再存 `localStorage`。直答失败时用 `src/data.ts` 的本地规则引擎降级，同样只写入浏览器。

知乎搜索结果只在服务进程内存里缓存约 5 分钟，不落库。

## PostgreSQL 实际用途

`DATABASE_URL` **仅服务知乎 OAuth**。未配置时，搜索与直答仍可工作，只是无法完成「绑定知乎」。

OAuth 相关表在 `db/migrations/003_zhihu_oauth.sql`、`004_oauth_identity_unique.sql`：

| 表 | 存什么 |
| --- | --- |
| `app_user` | 应用内用户（展示名） |
| `zhihu_oauth_account` | 知乎身份与加密后的 access token |
| `oauth_session` | 会话 token 的哈希（浏览器只持有 HttpOnly Cookie `zhixing_session`） |
| `oauth_state` | 授权过程中的短期 state |

Access token 用 `ZHIHU_OAUTH_SESSION_SECRET` 做 AES-256-GCM 加密后入库；会话 Cookie 里只有随机 token，服务端用哈希比对。

部署到 Neon / Supabase 时，仍需执行全部迁移文件（含早期业务表），因为 OAuth 表依赖 `app_user`。执行迁移不等于业务数据上云。

## 知乎开放平台

- `GET /api/zhihu/search?q=关键词`：站内搜索，返回摘要与溯源链接。
- `POST /api/papers/generate`：调用知乎直答 `zhida-thinking-1p5`，输出经 Zod 校验。
- `GET /api/auth/zhihu`、`/api/auth/zhihu/callback`、`/api/auth/me`、`POST /api/auth/logout`：OAuth 绑定与会话。
- 本地开发默认走已登录的官方知乎 CLI；部署环境用 `ZHIHU_ACCESS_SECRET` 直连 HTTP API。密钥只留在服务端。

环境变量见 `.env.example`，不要把真实密钥提交进仓库。

## Vercel 部署

`vercel.json` + `api/index.ts`：Vite 静态前端，Express 作为 Serverless Function。推荐 Neon 或 Supabase 的 pooled `DATABASE_URL`。

环境变量：

- `DATABASE_URL`：仅 OAuth
- `ZHIHU_ACCESS_SECRET`：开放平台 Access Secret
- `ZHIHU_APP_ID`、`ZHIHU_APP_KEY`：OAuth 应用凭证
- `ZHIHU_OAUTH_REDIRECT_URI`：已在知乎开放平台登记的回调
- `ZHIHU_OAUTH_SESSION_SECRET`：至少 32 位随机串
- `VERCEL=1`：平台自动注入

步骤：导入 GitHub 仓库，Framework 选 Vite，Build `pnpm run build`，Output `dist`，配好环境变量后部署，用 `/api/health` 检查 API、数据库连接与 OAuth 配置。

知乎直答可能较慢；当前函数上限 60 秒。超时需改为异步队列或迁到支持更长执行时间的环境。

## 已实现

- 笔记本创建、切换、删除（删除会一并去掉该本下的笔记和答卷）
- 想法、摘录、限制条件、尝试四类笔记的增删改、勾选
- 知乎摘录：搜索 → 选择内容 → 划线入库
- 提交所选笔记，生成结构化人生答卷（直答优先，失败则本地规则）
- 题目、已知条件、参考依据、四阶段行动、得分点、阅卷评语
- 阶段任务勾选与实时计分；多版本答卷（一诊、二诊等）与重新作答
- 知乎 OAuth 绑定/退出（不影响本地笔记数据）
- 桌面、移动端布局与打印样式

## 工程结构

- `src/App.tsx`：页面与交互
- `src/types.ts`：领域类型
- `src/data.ts`：首次默认数据、标签、本地答卷生成器
- `src/storage.ts`：`localStorage` 持久化
- `src/api.ts`：搜索、直答、OAuth 客户端（远程业务 CRUD 为未使用遗留）
- `src/styles.css`：视觉、响应式、打印
- `server/index.ts`：Express 入口（业务路由已关闭）
- `server/zhihu.ts`：CLI / HTTP 双适配、缓存、直答解析
- `server/oauth.ts`：OAuth 与会话
- `server/contracts.ts`：请求与 AI 输出校验
- `server/repository.ts`：历史 PostgreSQL 业务仓储，当前未接入路由
- `db/migrations/`：库表迁移（业务表闲置，OAuth 表在用）
- `api/index.ts`：Vercel 导出 Express 应用
