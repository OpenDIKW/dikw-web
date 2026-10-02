# dikw-web 部署指南

本文档说明如何把 dikw-web 部署成单个 Docker 容器。镜像内包含已构建的 SPA 静态资源和 agent sidecar（基于 Google ADK），两者由同一个 Node 进程同源对外暴露（默认端口 4321）。dikw-core 不在镜像内，需要用户自备。

## 架构速览

```text
浏览器
  │  http://<host>:4321/
  ├──▶ /agent/*   →  容器内 sidecar  →  调用 core / Tavily / Jina / LLM
  └──▶ /v1/*      →  浏览器在 Settings 中填的 core URL（跨容器/跨域）
                    （core 必须允许浏览器侧 CORS）
```

开启[鉴权模式](#鉴权模式oidc--bff)后，浏览器只访问 dikw-web 同源：`/v1/*` 由 dikw-web 校验会话与角色后，用服务端持有的 token 转发给 core，浏览器拿不到 core token。

## 必需环境变量

| 变量 | 含义 |
|---|---|
| `DIKW_AGENT_API_KEY` | LLM API key（如 MiniMax / Anthropic / OpenAI 兼容服务） |
| `DIKW_AGENT_BASE_URL` | LLM endpoint base URL，如 `https://api.minimaxi.com/anthropic` |
| `DIKW_AGENT_MODEL` | 具体 model 名 |

## 可选环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `DIKW_AGENT_PROVIDER` | `minimax` | provider 标识，仅用作日志显示 |
| `DIKW_AGENT_API` | `anthropic-messages` | `anthropic-messages` 或 `openai-completions` |
| `DIKW_AGENT_TAVILY_API_KEY` | _未设_ | 设置后启用 `web_search` 工具 |
| `DIKW_AGENT_JINA_API_KEY` | _未设_ | 设置后启用 `web_fetch` 工具 |
| `DIKW_WEB_MINERU_API_KEY` | _未设_ | 设置后启用 Import 页的 PDF / Office 转换（`/web/mineru/*`）。未设则 ImportPage 自动降级到 `.md/.pdf` 选择器并显示提示。 |
| `DIKW_WEB_HOST` | `0.0.0.0` | 监听 host |
| `DIKW_WEB_PORT` | `4321` | 监听 port |
| `DIKW_WEB_STATIC_DIR` | `/app/dist` | SPA 静态资源根目录 |
| `DIKW_AGENT_SESSIONS_DIR` | `/data/agent-sessions` | ADK sqlite 会话目录（内含 `agent.sqlite`，推荐挂 volume） |

启动时若必需变量缺失，进程会打印错误并以非零状态退出（fail-fast）。

## 用 `docker run` 启动

```bash
docker build -t dikw-web:local .

docker run --rm -p 4321:4321 \
  -e DIKW_AGENT_PROVIDER=minimax \
  -e DIKW_AGENT_API=anthropic-messages \
  -e DIKW_AGENT_API_KEY=sk-... \
  -e DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic \
  -e DIKW_AGENT_MODEL=MiniMax-M3 \
  -v dikw-agent-sessions:/data/agent-sessions \
  --add-host=host.docker.internal:host-gateway \
  dikw-web:local
```

打开 `http://127.0.0.1:4321/`，进入 **Settings** 把 *Server URL* 改成你的 dikw-core 地址（容器视角下宿主机 core 是 `http://host.docker.internal:8765`，**不是** `http://127.0.0.1:8765`），保存后即可使用。

## 用 `docker-compose` 启动

仓库根目录提供了 `docker-compose.yml`。把 LLM 凭证写到同级 `.env`（**不是** `.env.local`，那是 dev 模式专用）：

```dotenv
DIKW_AGENT_PROVIDER=minimax
DIKW_AGENT_API=anthropic-messages
DIKW_AGENT_API_KEY=sk-...
DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic
DIKW_AGENT_MODEL=MiniMax-M3
# 可选
# DIKW_AGENT_TAVILY_API_KEY=...
# DIKW_AGENT_JINA_API_KEY=...
```

然后：

```bash
docker compose up -d --build
docker compose logs -f dikw-web
```

## 与外部 dikw-core 的网络配置

容器内 `127.0.0.1` 指向容器自己，**不是宿主机**。把浏览器 Settings 中的 Server URL 填成：

- **宿主机本地 core**：`http://host.docker.internal:8765`（Linux 上需要 `--add-host=host.docker.internal:host-gateway`，compose 已写好）
- **同 docker 网络中的 core**：用 core 容器的 service 名，如 `http://dikw-core:8765`
- **远端 core**：直接填 `https://core.example.com`

**CORS 要求**：浏览器直连 core，所以 core 必须允许来自 `http://<your-host>:4321` 的跨域请求。如果你的 core 不支持 CORS，可以在 dikw-web 前面架一层反向代理（nginx/Caddy），把 `/v1/*` 同源转发给 core；或者开启[鉴权模式](#鉴权模式oidc--bff)，由 dikw-web 自己同源代理 `/v1/*`。

## 会话持久化

- ADK 会话数据（`agent.sqlite`，ADK `DatabaseSessionService`，本地 SQLite）写入 `DIKW_AGENT_SESSIONS_DIR`，镜像默认 `/data/agent-sessions`，已声明为 `VOLUME`。
- 升级镜像版本时，只要 volume 不删，已有对话历史会保留。

## 健康检查

镜像内置（探 `/healthz`——鉴权模式下唯一免登录的路由，`/agent/*` 那时会返回 401）：

```dockerfile
# node:24-slim 不带 wget/curl，用始终存在的 node 探活
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

`docker inspect --format='{{.State.Health.Status}}' <container>` 可观察。

## 鉴权模式（OIDC / BFF）

默认关闭。设置 `DIKW_WEB_AUTH_MODE=oidc` 后，dikw-web 变成一个 Backend-for-Frontend（设计见 [ADR 0006](adr/0006-oidc-auth-bff.md)，对应 [#200](https://github.com/OpenDIKW/dikw-web/issues/200)）：

- 用户经外部 OpenID Connect 身份提供方（Casdoor / Keycloak / Authentik / Entra ID / Google …）登录：Authorization Code + PKCE（S256），校验 `state` / `nonce` / `iss` / `aud` / `exp` / `azp`，并用 IdP 的 JWKS 校验 ID token 签名。
- dikw-core 的 token **只在服务端**：浏览器同源访问 `/v1/*`，dikw-web 校验会话和角色后用 `DIKW_SERVER_TOKEN` 转发给 `DIKW_CORE_URL`（NDJSON 流式检索、任务事件长轮询、multipart 导入都是流式透传；响应一律改成 `Cache-Control: private`，前面的 CDN / 共享缓存不会把登录用户的内容转给别人）。Settings 页不再显示 Server URL / Token，改为显示当前账户、角色和「退出登录」。
- `/agent/*`、`/web/*` 和 SPA 本身都需要登录；未登录的页面访问会跳转登录（登录后回到原来的 `#路由`），API 请求返回 401。只有 `/healthz` 免登录。
- 聊天会话**按用户隔离**（ADK `userId` = `oidc:<sub>`，加前缀是为了让任何 IdP 的 `sub` 都不可能等于旧的 `demo`）：别人的会话 id 一律 404。
- 两级角色 **viewer / editor**（editor 包含 viewer），由服务端强制；界面只是把 viewer 用不了的操作藏起来。

| 能力 | viewer | editor |
|---|:-:|:-:|
| 浏览页面、图谱、任务（`GET /v1/*`），`POST /v1/retrieve`、`POST /v1/doc/search` | ✅ | ✅ |
| 和 agent 聊天（自己的会话）、双语阅读（`/web/translate/*`） | ✅ | ✅ |
| 导入与文档转换（`POST /v1/import`、`/web/mineru/*`） | ❌ | ✅ |
| `ingest` / `synth` / `eval`、`lint propose` / `lint apply`、取消任务、写 wisdom | ❌ | ✅ |
| 确认 agent 的维护提案（`POST /agent/sessions/{id}/proposals/{pid}/confirm`） | ❌ | ✅ |

其余未列出的 core 写接口一律只给 editor。已登录但没有映射到任何角色的用户会看到「无访问权限」页面（可在页面上退出登录）。

### 鉴权模式环境变量

开启后，缺少必需变量会在启动时报错退出（fail-fast），错误信息只列变量名、不打印值。

| 变量 | 必需 | 默认 | 含义 |
|---|:-:|---|---|
| `DIKW_WEB_AUTH_MODE` | | _未设_ | `oidc` 开启；未设 / `off` 关闭 |
| `DIKW_WEB_PUBLIC_URL` | ✅ | | 浏览器访问的 origin（不带路径），如 `https://kb.example.com`。回调地址 = `{PUBLIC_URL}/web/auth/callback`；为 https 时 Cookie 带 `Secure`；CSRF 校验要求写请求的 `Origin` 与它完全相等 |
| `DIKW_WEB_OIDC_ISSUER` | ✅ | | IdP 的 issuer，用于 `{issuer}/.well-known/openid-configuration` 发现 |
| `DIKW_WEB_OIDC_INTERNAL_URL` | | _未设_ | IdP 在内网的 origin（如 `http://casdoor:8000`）。只把服务端到 IdP 的调用（discovery / token / JWKS）改走这里，浏览器跳转仍用公网 issuer。此时 IdP 必须固定公网 hostname（通过内网取到的 discovery 里 `issuer` 仍须是公网值） |
| `DIKW_WEB_OIDC_CLIENT_ID` | ✅ | | OIDC client id |
| `DIKW_WEB_OIDC_CLIENT_SECRET` | ✅ | | client secret（`client_secret_post`），不会发给浏览器 |
| `DIKW_WEB_OIDC_SCOPES` | | `openid profile email` | 申请的 scope |
| `DIKW_WEB_OIDC_ROLES_CLAIM` | | `roles` | 从 ID token 读角色的路径：`roles`、`groups`、`realm_access.roles`、`roles[].name`（`[]` 表示遍历数组） |
| `DIKW_WEB_OIDC_ROLES_OWNER` | | _未设_ | 只保留 `owner` 等于该值的角色对象（Casdoor 的组织）；`isEnabled: false` 的角色对象总会被忽略 |
| `DIKW_WEB_ROLE_VIEWER` | 二者至少一个 | | 映射为 viewer 的角色名，逗号分隔 |
| `DIKW_WEB_ROLE_EDITOR` | 二者至少一个 | | 映射为 editor 的角色名，逗号分隔 |
| `DIKW_WEB_SESSION_SECRET` | ✅ | | ≥ 32 字符的随机串（如 `openssl rand -base64 48`）。用于加密服务端会话；更换它会让所有人重新登录 |
| `DIKW_WEB_SESSION_TTL_SECONDS` | | `28800`（8 小时） | 登录会话的绝对有效期。不做 refresh token 续期；角色变更在下次登录生效 |
| `DIKW_CORE_URL` | ✅ | | dikw-core 地址（服务端视角），如 `http://dikw-core:8765` |
| `DIKW_SERVER_TOKEN` | ✅ | | dikw-core 的 bearer token |
| `DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER` | | _未设_ | 见下文「开启前的旧会话」 |

登录会话存在 `DIKW_AGENT_SESSIONS_DIR` 下的 `auth.sqlite`（与 `agent.sqlite` 同一个 volume，重启 / 升级不掉登录）。文件里只有会话 id 的 SHA-256 和 AES-256-GCM 加密后的记录，泄露也拿不到可用 Cookie 或身份信息。日志和 OTel span 里不会出现任何 token。

鉴权模式只在生产服务端（`npm start` / Docker 镜像）生效；`npm run dev` 永远不鉴权。

### 在 IdP 上注册应用

- **Redirect URI**：`{DIKW_WEB_PUBLIC_URL}/web/auth/callback`
- **Post-logout redirect URI**：`{DIKW_WEB_PUBLIC_URL}/`（IdP 声明了 `end_session_endpoint` 时，「退出登录」会走 RP-initiated logout；否则只清本地会话，并停在「已退出登录」页，不会被 IdP 自动登录回来）
- **角色进 ID token**：Casdoor 默认的 JWT 格式已包含 `roles`（对象数组，用 `DIKW_WEB_OIDC_ROLES_CLAIM=roles[].name` + `DIKW_WEB_OIDC_ROLES_OWNER=<组织>`）；Keycloak 需在 roles mapper 上打开 "Add to ID token"（`realm_access.roles`）；Entra ID 的 app roles 在 `roles`；Authentik 的 groups 在 `groups`。

Casdoor 示例：

```dotenv
DIKW_WEB_AUTH_MODE=oidc
DIKW_WEB_PUBLIC_URL=https://kb.example.com
DIKW_WEB_OIDC_ISSUER=https://iam.example.com
DIKW_WEB_OIDC_INTERNAL_URL=http://casdoor:8000
DIKW_WEB_OIDC_CLIENT_ID=...
DIKW_WEB_OIDC_CLIENT_SECRET=...
DIKW_WEB_OIDC_ROLES_CLAIM=roles[].name
DIKW_WEB_OIDC_ROLES_OWNER=my-org
DIKW_WEB_ROLE_VIEWER=kb_viewer
DIKW_WEB_ROLE_EDITOR=kb_editor
DIKW_WEB_SESSION_SECRET=<openssl rand -base64 48>
DIKW_CORE_URL=http://dikw-core:8765
DIKW_SERVER_TOKEN=...
```

用 docker compose 时，把这些变量加进 `dikw-web` 服务的 `environment:`（`docker-compose.yml` 默认只透传 LLM / 工具相关变量）。

### 开启前的旧会话

关闭鉴权时所有聊天会话都存在同一个 `userId: "demo"` 下。开启鉴权后它们**默认对所有人隐藏**（数据原样保留，关掉鉴权后重新可见）。如果想把它们交给某个人继续用，设置 `DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER=<该用户的 OIDC sub>`：这个用户会在自己的会话列表里看到旧会话并可以继续对话、改名、删除（读取时合并，不改 ADK 的内部表）；其他用户仍看不到。

### 反向代理：浏览器走 dikw-web，机器客户端直连 core

`dikw client`、脚本、MCP 等机器客户端继续带 bearer token 直连 dikw-core，不经过 dikw-web 的登录。同一个域名下可以按 `Authorization: Bearer` 头分流（dikw-core 不需要任何改动）：

```caddy
kb.example.com {
	# 带 Bearer token 的 /v1 请求（机器客户端）→ 直连 dikw-core
	@machine {
		path /v1/*
		header Authorization "Bearer *"
	}
	handle @machine {
		reverse_proxy dikw-core:8765
	}
	# 其余（浏览器）→ dikw-web；它校验会话后再用服务端 token 转发 /v1
	handle {
		reverse_proxy dikw-web:4321 {
			flush_interval -1
		}
	}
}
```

nginx 等价写法：

```nginx
map $http_authorization $kb_upstream {
    "~^Bearer "  dikw_core;   # 机器客户端
    default      dikw_web;    # 浏览器
}
upstream dikw_core { server dikw-core:8765; }
upstream dikw_web  { server dikw-web:4321; }

server {
    listen 443 ssl;
    server_name kb.example.com;
    client_max_body_size 200m;   # 导入 / 文档转换
    proxy_buffering off;         # NDJSON 流式检索、任务事件长轮询
    proxy_read_timeout 120s;

    location /v1/ { proxy_pass http://$kb_upstream; }
    location /    { proxy_pass http://dikw_web; }
}
```

代理必须原样透传浏览器的 `Origin` 头（默认就会），dikw-web 用它做 CSRF 校验。

## 常见故障

| 现象 | 排查方向 |
|---|---|
| 启动即退出，日志含 `agent configuration error: DIKW_AGENT_* is required` | 缺必需 env，按上表补齐 |
| 浏览器能开页面，但 Overview/Wiki 报网络错误 | Settings 中的 core URL 在容器视角下不可达；改 `host.docker.internal` 或内网 IP；或 core CORS 未放行 |
| Chat 一发消息就报错 | sidecar → LLM 失败：核对 `DIKW_AGENT_BASE_URL` / `DIKW_AGENT_MODEL`；或 LLM provider 余额 / 网络代理 |
| 重启后会话消失 | 没挂 volume；确认 `-v dikw-agent-sessions:/data/agent-sessions` 或 compose 中的 `volumes` 段 |
| 端口冲突 | 改 `-p 18080:4321` 或调 `DIKW_WEB_PORT` |
| 启动即退出，日志含 `auth configuration error` | 鉴权模式缺必需变量或格式不对（错误里列出了变量名），按「鉴权模式环境变量」补齐 |
| 登录后显示「登录失败」 | ID token 校验没通过：核对 `DIKW_WEB_OIDC_CLIENT_ID`、IdP 的 issuer 与 `DIKW_WEB_OIDC_ISSUER` 是否逐字一致；dikw-web 日志里有 `sign-in rejected` 和原因 |
| 登录后显示「无访问权限」 | 账号的角色没映射上：核对 `DIKW_WEB_OIDC_ROLES_CLAIM` / `_ROLES_OWNER` / `DIKW_WEB_ROLE_*`，以及角色是否进了 ID token |
| 写操作返回 403 `csrf_origin_mismatch` | 浏览器访问的 origin 与 `DIKW_WEB_PUBLIC_URL` 不一致（协议、域名、端口都要一样） |
| 已登录，但所有页面报 502 `core_auth_failed` | dikw-core 拒绝了 `DIKW_SERVER_TOKEN`（日志里有 `core rejected DIKW_SERVER_TOKEN`）：核对 token 是否与 core 一致、是否已轮换。这时 dikw-web 不会把 401 转给浏览器，免得浏览器反复跳去登录 |

## 升级与回滚

```bash
# 升级
docker pull <registry>/dikw-web:<new-tag>
docker compose up -d
# 回滚
docker compose down
docker run ... <registry>/dikw-web:<old-tag>
```

session volume 与镜像 tag 解耦，回滚不会丢历史。
