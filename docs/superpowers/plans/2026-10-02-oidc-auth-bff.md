# 可选 OIDC 鉴权模式(BFF)— 实施计划

> 对应 issue [#200](https://github.com/OpenDIKW/dikw-web/issues/200)。设计决策见
> [docs/adr/0006-oidc-auth-bff.md](../../adr/0006-oidc-auth-bff.md)。

**Goal:** 用 `DIKW_WEB_AUTH_MODE=oidc` 打开一个默认关闭的鉴权模式,把 standalone Node 进程变成
BFF:用户经外部 OIDC IdP 登录;dikw-core token 只留在服务端;agent 会话按用户隔离;viewer /
editor 两级角色在服务端强制。关闭时行为与现在完全一致。

**已确认的决策(2026-10-02,与维护者澄清):**

- 一个 PR,分层提交。
- OIDC 协议用 `openid-client` v6(依赖 `jose` + `oauth4webapi`)。
- 登录会话持久化到 `DIKW_AGENT_SESSIONS_DIR/auth.sqlite`(Node 内置 `node:sqlite`,不新增原生依赖);
  只存会话 ID 的 SHA-256;整条会话记录(含 `id_token`、身份声明)AES-256-GCM 加密。
- 旧 `userId="demo"` 会话:`DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER=<sub>` 时**读时合并**给该用户
  (不改 ADK 内部表);未设置则在鉴权模式下隐藏(数据保留,关掉鉴权后重新可见)。

**默认假设(未单独提问):**

- 角色只从**已验证的 ID token** 声明读取(Casdoor 默认 JWT 含 `roles`;Keycloak 需在 mapper
  勾选 "Add to ID token")。
- 鉴权只在 standalone 服务端(`npm start` / Docker)生效;`npm run dev` 永远不鉴权。
- 会话寿命 = 可配置绝对 TTL(`DIKW_WEB_SESSION_TTL_SECONDS`,默认 8h),不做 refresh token
  续期;角色变更下次登录生效。
- 鉴权模式下 `DIKW_CORE_URL` + `DIKW_SERVER_TOKEN` 必填。

---

## 请求流(鉴权模式)

```text
浏览器 ──▶ standalone (DIKW_WEB_PUBLIC_URL)
  /healthz                  免鉴权存活探针(两种模式都有)
  /web/auth/login|callback  OIDC Authorization Code + PKCE(S256) + state + nonce
  /web/auth/logout (POST)   删本地会话 → 303 到 end_session_endpoint(若有)
  /web/auth/me              { enabled, user, role }
  其余全部先过 gate:
    无会话 → 导航 302 登录 / API 401
    无角色 → 403(HTML 页带 Sign out / JSON)
    非 GET/HEAD/OPTIONS → Origin 必须精确等于 PUBLIC_URL 的 origin
    requiredRole(method, path) 不满足 → 403
  /v1/*    → coreProxy → DIKW_CORE_URL + Bearer DIKW_SERVER_TOKEN(流式)
  /agent/* → agentHandler(userId = sub,core 连接用服务端配置)
  /web/*   → webHandler
  其他     → SPA 静态资源
```

## 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `server/auth/config.ts` | 新建 | `loadAuthConfig()`:关闭 → `null`;开启时一次性列出所有缺失变量并抛错(fail fast) |
| `server/auth/roles.ts` | 新建 | `extractRoles(claims, path, owner)`(`roles` / `groups` / `realm_access.roles` / `roles[].name`,Casdoor `owner` / `isEnabled`)、`resolveRole`、`requiredRole(method, path)`(issue 中的权限矩阵,单一纯函数) |
| `server/auth/seal.ts` | 新建 | HKDF 派生密钥 + AES-256-GCM `seal`/`open`;按用途分离密钥 |
| `server/auth/sessionStore.ts` | 新建 | `AuthSessionStore`(`node:sqlite`):`create/get/delete`,过期清理,ID 哈希、记录加密 |
| `server/auth/oidc.ts` | 新建 | `openid-client` 封装:惰性 discovery、内网 URL 改写(`customFetch`)、授权 URL、回调校验(+ 显式 `azp` 检查)、`end_session` URL |
| `server/auth/gate.ts` | 新建 | `/web/auth/*` 路由 + 会话/角色/CSRF 闸门 + 403 页 + `returnTo` 同源校验 + `principalOf(req)` |
| `server/auth/coreProxy.ts` | 新建 | `/v1/*` 流式反代:注入 Bearer、剥离 cookie/Authorization、`Accept-Encoding: identity`、客户端断开即中止上游、上游不可达 502 |
| `server/agent/adkSessionStore.ts` | 修改 | `forUser(userId, legacyUserId?)`、读时合并、`ownerOf(id)`、`SessionNotFoundError` |
| `server/agent/adkRunner.ts` / `runtime.ts` | 修改 | `runMessage({ userId })` 取代常量 `"demo"` |
| `server/agent/http.ts` | 修改 | `userIdFor` / `serverCore` / `legacySessionsOwner` 选项;所有会话路由按用户;不存在/他人会话 → 404;traces/abort 先校验归属 |
| `server/web/http.ts` | 修改 | 关闭模式下 `GET /web/auth/me` → `{ enabled: false }` |
| `server/agent/standalone.ts` | 修改 | 组装 gate + proxy;`/healthz` |
| `Dockerfile` | 修改 | `HEALTHCHECK` 改探 `/healthz` |
| `src/config/auth.ts` | 新建 | `loadAuth()`、`AuthContext` / `useAuth` / `useCanEdit`、`installUnauthorizedRedirect()`(401 → 登录并带回当前页) |
| `src/main.tsx` | 修改 | 启动时并行加载 auth,包 Provider |
| `src/App.tsx` / `src/mb/MbApp.tsx` | 修改 | 鉴权模式:同源 `/v1`、无 token、agent 不发 coreUrl;顶栏显示用户;viewer 隐藏 Import |
| `src/pages/SettingsPage.tsx` | 修改 | 鉴权模式:账户面板(用户、角色、Sign out 表单)代替 Server URL/Token |
| `src/pages/{TasksPage,ChatPage,WisdomPage}.tsx`、`src/mb/*` | 修改 | viewer 隐藏 editor-only 操作(服务端仍是唯一准绳) |
| `src/i18n.ts` | 修改 | 新文案(en / zh-CN) |
| `docs/adr/0006-oidc-auth-bff.md` | 新建 | ADR |
| `docs/deployment.md` | 修改 | 鉴权模式章节 + 反向代理示例(浏览器流量 → dikw-web,机器 Bearer 流量 → dikw-core)+ `/healthz` |
| `CLAUDE.md` / `README.md` / `docs/agent.md` / `.env.example` / `CHANGELOG.md` / `package.json` | 修改 | 文档同步;版本 `0.9.2` → `0.10.0` |

## 分层提交与每步检查

1. **鉴权核心**(config / roles / seal / sessionStore / oidc / gate)
   - 先写失败测试:配置 fail-fast、角色提取与权限矩阵表驱动测试、会话存储落盘加密、
     伪 IdP(`node:http` + `node:crypto` 签 RS256)全流程:PKCE S256 / state / nonce / iss /
     aud / azp / exp 篡改各自被拒;`returnTo` 开放重定向被拒;CSRF Origin;viewer/editor 403;
     logout 303 + `id_token_hint`;响应中从不出现 client secret / core token。
   - 检查:`npx vitest run server/auth`
2. **`/v1` 反代**
   - 测试:伪 core 校验 Bearer、cookie 不透传;NDJSON 分块在上游结束前即到达;长轮询;multipart
     字节一致;上游不可达 502;客户端断开中止上游。
   - 检查:`npx vitest run server/auth/coreProxy.test.ts`
3. **按用户的 agent 会话**
   - 测试:两用户 list / get / rename / delete / abort / messages / traces / proposals 互相 404;
     `serverCore` 覆盖请求体 `coreUrl`;legacy owner 读时合并;关闭模式行为不变。
   - 检查:`npx vitest run server/agent`
4. **standalone 组装 + `/healthz` + Dockerfile**
   - 检查:`npm.cmd run typecheck`、`npm.cmd run build`,本地起 standalone + 伪 IdP 手工走一遍。
5. **前端**
   - 测试:`loadAuth` 解析、401 重定向(只触发一次、只对同源 `/v1|/agent|/web`)、Settings
     账户面板、viewer 下 Import / 任务维护按钮 / 提案确认隐藏。
   - 检查:`npx vitest run src/config/auth.test.ts src/pages`,浏览器(Chrome MCP)亮/暗两套
     验证账户面板与 viewer 视图。
6. **文档 + 版本**
7. **总闸**:`npm.cmd run verify`、`npm.cmd run check:bundle`、`npm.cmd run check:gate`。

## 已知不做(v1)

- refresh token 续期、按 access token / userinfo 取角色。
- `/web/*` 转换/翻译 job 按用户隔离(job ID 为不可猜 UUID;记录为后续项)。
- Vite dev server 的鉴权模式。
