# dikw-web 部署指南

本文档说明如何把 dikw-web 部署成单个 Docker 容器。镜像内包含已构建的 SPA 静态资源和 Pi-Agent sidecar，两者由同一个 Node 进程同源对外暴露（默认端口 4321）。dikw-core 不在镜像内，需要用户自备。

## 架构速览

```text
浏览器
  │  http://<host>:4321/
  ├──▶ /agent/*   →  容器内 sidecar  →  调用 core / Tavily / Jina / LLM
  └──▶ /v1/*      →  浏览器在 Settings 中填的 core URL（跨容器/跨域）
                    （core 必须允许浏览器侧 CORS）
```

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
| `DIKW_WEB_HOST` | `0.0.0.0` | 监听 host |
| `DIKW_WEB_PORT` | `4321` | 监听 port |
| `DIKW_WEB_STATIC_DIR` | `/app/dist` | SPA 静态资源根目录 |
| `DIKW_AGENT_SESSIONS_DIR` | `/data/agent-sessions` | 会话 JSON 文件目录（推荐挂 volume） |

启动时若必需变量缺失，进程会打印错误并以非零状态退出（fail-fast）。

## 用 `docker run` 启动

```bash
docker build -t dikw-web:local .

docker run --rm -p 4321:4321 \
  -e DIKW_AGENT_PROVIDER=minimax \
  -e DIKW_AGENT_API=anthropic-messages \
  -e DIKW_AGENT_API_KEY=sk-... \
  -e DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic \
  -e DIKW_AGENT_MODEL=MiniMax-M2.7 \
  -v dikw-agent-sessions:/data/agent-sessions \
  --add-host=host.docker.internal:host-gateway \
  dikw-web:local
```

打开 `http://127.0.0.1:4321/`，进入 **Settings** 把 *Server URL* 改成你的 dikw-core 地址（容器视角下宿主机 core 是 `http://host.docker.internal:8765`，**不是** `http://127.0.0.1:8765`），保存后即可使用。

## 用 `docker-compose` 启动

仓库根目录提供了 `docker-compose.yml`。把 LLM 凭证写到同级 `.env`（**不是** `.env.agent.local`，那是 dev 模式专用）：

```dotenv
DIKW_AGENT_PROVIDER=minimax
DIKW_AGENT_API=anthropic-messages
DIKW_AGENT_API_KEY=sk-...
DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic
DIKW_AGENT_MODEL=MiniMax-M2.7
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

**CORS 要求**：浏览器直连 core，所以 core 必须允许来自 `http://<your-host>:4321` 的跨域请求。如果你的 core 不支持 CORS，可以在 dikw-web 前面架一层反向代理（nginx/Caddy），把 `/v1/*` 同源转发给 core（未来如果有强需求，dikw-web 会内置一个 `DIKW_WEB_CORE_PROXY` env 开关）。

## 会话持久化

- session JSON 写入 `DIKW_AGENT_SESSIONS_DIR`，镜像默认 `/data/agent-sessions`，已声明为 `VOLUME`。
- 升级镜像版本时，只要 volume 不删，已有对话历史会保留。

## 健康检查

镜像内置：

```dockerfile
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4321/agent/sessions
```

`docker inspect --format='{{.State.Health.Status}}' <container>` 可观察。

## 常见故障

| 现象 | 排查方向 |
|---|---|
| 启动即退出，日志含 `agent configuration error: DIKW_AGENT_* is required` | 缺必需 env，按上表补齐 |
| 浏览器能开页面，但 Overview/Wiki 报网络错误 | Settings 中的 core URL 在容器视角下不可达；改 `host.docker.internal` 或内网 IP；或 core CORS 未放行 |
| Chat 一发消息就报错 | sidecar → LLM 失败：核对 `DIKW_AGENT_BASE_URL` / `DIKW_AGENT_MODEL`；或 LLM provider 余额 / 网络代理 |
| 重启后会话消失 | 没挂 volume；确认 `-v dikw-agent-sessions:/data/agent-sessions` 或 compose 中的 `volumes` 段 |
| 端口冲突 | 改 `-p 18080:4321` 或调 `DIKW_WEB_PORT` |

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
