# dikw-web 与 dikw-mbweb 拆仓实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 仅在维护者选择委派执行后使用 superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理工作台和迈博业务应用拆成两个独立仓库，通过公开 npm 共享包复用协议、UI 与服务端能力，并完成配置、数据迁移、CI、部署和回退验证。

**Architecture:** `dikw-web` 保存管理应用及三个共享 workspace 包，`dikw-mbweb` 保存私有业务应用。两套应用共用同一个 Core 知识库，分别运行 BFF，共享运行库，通过服务端 profile 控制可用能力。MB 的论文、问答、笔记模型与页面留在私有仓库。

**Tech Stack:** Node 24、npm、TypeScript、React 19、Vite、Vitest、Playwright、openid-client、Google ADK、SQLite、Docker、GitHub Actions、公开 npm。

**Spec:** [拆仓设计](../specs/2026-10-03-mbweb-repository-split-design.md)。执行者先阅读设计、CLAUDE.md、CONTEXT.md、docs/core-contract.md、docs/tdd.md、docs/review-rubric.md 和相关部署/Agent/UI 文档。

## 全局约束

- 共享包采用 MIT，发布到公开 npm；应用根 package.json 保持 `private: true`，MB 声明 `license: "UNLICENSED"`。
- 保留 Node `>=24.0.0`、React 19、TypeScript、Vite、Vitest、Playwright 与现有 npm。
- 首期共享包统一为 `0.1.0`；候选版本为 `0.1.0-rc.1`，使用 `next` 标签。两个应用版本分别维护。
- 应用与包的正式依赖使用精确 SemVer 和 lockfile；最终提交不能依赖跨仓库 `file:`、工作台源码或临时 tarball 路径。
- 工作台现有 coverage 下限保持 statements `60`、branches `45`、functions `55`、lines `60`；迁出代码不能变成未计入 coverage 的代码。
- 工作台现有 gzip 预算保持 entry JS `280 KB`、total JS `1950 KB`、CSS `35 KB`；MB 首期使用相同上限并记录其独立基线。
- `.npmrc` 的 `ignore-scripts=true` 保留；build、CSS 复制、pack、发布检查显式执行，不依赖生命周期脚本。
- 首期不引入 Nx、Turborepo、Lerna、UI 框架；不改变 Core API/NDJSON 协议、auth/agent sqlite schema、现有 #204/#205 行为。
- 新 Node runtime 模块相对导入带 `.js`；React/ReactDOM 由应用提供，UI 包不能内联 React 或创建第二份 AuthContext。
- 公共包与工作台不能依赖私有仓库；公开 CI 不获得私有 MB 源码凭证，私有测试报告和业务资产留在私有仓库。
- Core 拓扑已确认采用 A：两套应用共用现有 Core 知识库；工作台管理 MB 的数据，两套 BFF、权限配置、会话与部署独立。Core 数据留在原库，迁移应用与浏览器数据。

## 交付与依赖顺序

| 交付批次 | 任务 | 阶段结束时的可运行状态 |
| --- | --- | --- |
| 工作台 PR 1 | 任务 1 | 当前两套 UI 都通过 client 包工作 |
| 工作台 PR 2 | 任务 2 | 当前两套 UI 都通过公共 UI 包工作 |
| 工作台 PR 3 | 任务 3 | 当前应用使用共享运行库；MB profile 有测试，但旧 hash 应用暂仍在工作台服务中 |
| 工作台 PR 4 与 npm 候选 | 任务 4 | 三个包可以打包、安装、发布候选；公开 CI 不需要私有代码 |
| 私有仓库初始 PR | 任务 5 | 私有 MB 使用候选包独立构建、运行和验证 |
| 两仓迁移 PR | 任务 6 | 原站点可导出，MB 可幂等导入；正式共享包可以发布 |
| 工作台清理 PR | 任务 7 | 公开产物移除 MB 页面，旧 hash 仅提供迁移出口 |
| 部署与验收记录 | 任务 8 | 两套生产实例通过真实集成和回退演练 |

所有代码批次按现有 delivery workflow 执行：可观察行为先写失败测试，最小实现，定向验证，文档同步，完整 gate，独立审查，再处理 CI/review。跨仓库切换不要求两个 PR 同时合并；包发布和旧应用保留期提供兼容窗口。

## 任务 1 提取共享客户端并建立 workspace

**文件：**

- 创建：`packages/web-client/package.json`、`tsconfig.build.json`、`LICENSE`、`README.md`、`src/{core,agent,types,import,convert,translate,document,connection}/` 与明确的子入口。
- 迁移：`src/api/{client,agentClient,ndjson}.ts` 及测试，`src/types.ts`、`src/agent/{types,traceTypes}.ts`。
- 迁移依赖闭包：`utils/import-bundle`、`frontmatter-merge`、`kebab-source-name`、`md-asset-refs`、`tar`、`tar-reader`、`mineru-convert`、`translate`、`markdown`、`markdown-blocks`、`lang`、`format` 与它们确实需要的本地依赖/测试。不迁移管理图谱工具。
- 修改：根 `package.json`、lockfile、tsconfig、vite.config.ts、src 与 server 的相关 imports、scripts/seed-core.mts 及其他直接消费这些模块的脚本。
- 创建：`packages/web-client/src/types/auth.ts`；迁移现有 AuthRole/AuthUser/AuthState，仅扩展可选的 `issuer` 与 `coreId`，不改现有字段。
- 测试：迁移后的 client 协议测试、`packages/web-client/src/core/public-api.test.ts`、打包消费 fixture。

**接口：** 消费现有 Core/Agent 协议。输出 `DikwClient`、`DikwClientError`、`AgentClient`、`AgentClientError`、`decodeNdjsonStream`、现有协议类型和通用工具；方法签名与响应语义保持原样。`/connection` 输出 `defaultServerUrl`，应用专属 storage keys 保留在应用内。

转换和翻译 cache 入口扩展一个兼容参数，省略时保持原数据库名、版本与 TTL：

```ts
// /convert
export function tryOpenDefaultCache(
  options?: { namespace?: string },
): Promise<ConvertCache | null>;
// /translate
export function tryOpenDefaultTranslateCache(
  options?: { namespace?: string },
): Promise<TranslateCache | null>;
```

- [x] 记录当前基线并创建 `codex/` 实施分支；生成“原测试文件 → 目标文件 → 行为 → CI”迁移清单。先跑当前 verify、bundle、gate，失败必须先区分基线问题。
- [x] 新增包入口的行为测试，首次运行应因包/入口不存在而失败；验证真实 HTTP 请求参数与返回数据，不检查文件布局。

```ts
import { afterEach, expect, it, vi } from "vitest";
import { DikwClient } from "@opendikw/web-client/core";

afterEach(() => vi.unstubAllGlobals());

it("preserves the core URL, bearer header and JSON result", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new DikwClient({ baseUrl: "https://core.invalid", token: "test-token" });
  await expect(client.get("/v1/health")).resolves.toEqual({ status: "ok" });
  const [input, init] = fetchMock.mock.calls[0];
  expect(String(input)).toBe("https://core.invalid/v1/health");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
});
```

- [x] 建立 workspace 与 ESM/声明构建；移动代码和依赖闭包，更新 imports。根应用保持 private；包公开入口使用以下结构，不通过 `src` deep import 消费。

```json
{
  "workspaces": ["packages/*"],
  "private": true,
  "dependencies": { "@opendikw/web-client": "0.1.0" }
}
```

```ts
// packages/web-client/src/core/index.ts
export { DikwClient, DikwClientError, normalizeBaseUrl, buildRequestUrl } from "./client.js";
export type { DikwClientConfig, JsonRequestOptions } from "./client.js";
```

- [x] 将根 coverage/test discovery 扩展到迁入包的代码与测试；保留全部现有断言。client 核心入口做无 DOM 的 Node import smoke，浏览器工具按子入口验证。显式 `npm.cmd run build:packages` 后再运行原应用 build。
- [x] 运行定向协议测试和全 gate，更新 README/Core contract 中的包入口说明；提交 `refactor(client): extract shared web client package`。

**验证命令：** `npm.cmd run typecheck`、`npx.cmd vitest run packages/web-client/src`、`npm.cmd run verify`、`npm.cmd run check:bundle`、`npm.cmd run check:gate`。如果 CI/coverage 配置改变触发 gate，提交迁移证据，走现有 `gate-change` 维护者流程。

## 任务 2 提取共享 UI 与主题层

**文件：**

- 创建：`packages/web-ui/{package.json,tsconfig.build.json,LICENSE,README.md}`、`src/{controls,reader,hooks,auth,theme}/`、`styles/{tokens,controls,reader}.css`。
- 迁移：现有公共控件、MarkdownView、markdown-runtime、BilingualView、FrontmatterChip、useAsyncResource、useBilingualReader 及对应测试；阅读器 chart-spec 随 UI 迁移。
- 拆分：`src/config/auth.ts` 的运行逻辑进入 UI `/auth`，协议类型来自 client `/types`；`src/i18n.ts` 的主题类型/机制进入 `/theme`，文案字典保持应用内。
- 修改：`src/styles.css`、`src/main.tsx`、现有工作台与 `src/mb` imports、包构建/CSS 资源复制脚本、设计文档。
- 测试：`packages/web-ui/src/reader/consumer.test.tsx`、已有 Markdown/双语/hooks/控件 tests 和两应用浏览器场景。

**接口：** 消费任务 1 的协议/文档/翻译入口。输出现有组件/hook 签名、同一个 AuthContext/useAuth/useCanEdit、loadAuth/installUnauthorizedRedirect；新增 `useTheme({ storageKey })`，结果为 `{ preference, resolved, setPreference }`，分别为 `ThemePreference`、`ResolvedTheme`、`(value: ThemePreference) => void`。

- [x] 写公共消费边界测试，导入新子入口；包未实现时应失败。

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownView } from "@opendikw/web-ui/reader";

it("renders a heading and preserves sanitized HTML behavior", () => {
  const { container } = render(
    <MarkdownView body={'# Paper\n\n<script>alert(1)</script>\n\n**Evidence**'} />,
  );
  expect(screen.getByRole("heading", { name: "Paper" })).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("strong")?.textContent).toBe("Evidence");
});
```

- [x] 迁移组件和 hooks，使用 client 包入口消除应用依赖；AuthState 可选标识由 loadAuth 校验后保留，工作台忽略可选字段。共享 UI 不导入 CurrentPaper/MbNote、工作台导航或翻译字典。
- [x] 拆分 CSS，应用按层引入；在 package.json 标记 CSS 副作用并让 React 外置。工作台 i18n 可暂时 re-export 主题类型以减少一次性 call-site 改动，最终机制只有一份。

```json
{
  "peerDependencies": { "react": ">=19 <20", "react-dom": ">=19 <20" },
  "sideEffects": ["**/*.css"],
  "dependencies": { "@opendikw/web-client": "0.1.0" }
}
```

```ts
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
import "@opendikw/web-ui/reader.css";
import "./styles.css";
```

- [x] 从真实 tarball 安装 UI 的消费 fixture，使用同一 Provider 渲染权限控件和 reader，确认没有双 React/双 Context；验证 KaTeX 字体、Mermaid/ECharts 动态块及受保护图片加载。这里的重依赖留在 reader 子入口，GraphCanvas 留在工作台。
- [x] 跑定向测试、两应用真实浏览器亮暗主题、完整 gate；更新 DESIGN/UI system 的样式归属，提交 `refactor(ui): extract shared controls and reader package`。

**验证：** `npm.cmd run build:packages`、`npx.cmd vitest run packages/web-ui/src`、`npm.cmd run verify`、`npm.cmd run check:bundle`；浏览器覆盖工作台 Base/Settings/Graph 与旧 MB 研究/笔记。主题 system 状态及 OS 变化行为保持；基础控件消费产物不包含 Mermaid/ECharts/Node runtime。

## 任务 3 提取共享服务端并建立应用 profile

**实施状态（2026-10-04）：** PR #213/#214/#215 已合并，共享服务端完整门禁已通过。隔离真实 Casdoor Docker 与双 BFF 已验证登录、角色刷新升降级、viewer 写入限制、跨应用 Cookie 拒绝及 SQLite 会话重启；生产镜像、Core token、IdP SSO/logout 和回退仍待验收。

**文件：**

- 创建：`packages/web-server/{package.json,tsconfig.build.json,LICENSE,README.md}`、`src/{runtime,auth,agent,web,shared,vite}/`。
- 迁移：`server/auth/`、`server/web/`、`server/shared/`、Agent 的实现与 tests；把 standalone 的静态服务与启动装配拆成 runtime 模块。
- 创建：`src/runtime/{createWebRuntime,profile}.ts`、`profile.test.ts`、`profile.integration.test.ts`、`createWebRuntime.test.ts`。
- 修改：`server/agent/standalone.ts` 为工作台薄入口，vite.config.ts 从包的 `/vite` 导入插件，Dockerfile 的 workspace 安装/生产依赖复制，以及所有包内 `../../src` 引用。
- 调整：Agent store/runner 的 appName、工具选择与 systemPrompt；工作台保持 `dikw-web`，MB 使用 `dikw-mbweb`。

**接口：**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

export type ApplicationProfile = "workbench" | "mbweb";
export interface WebRuntimeOptions {
  appId: "dikw-web" | "dikw-mbweb";
  profile: ApplicationProfile;
  cwd?: string;
  staticDir?: string;
  env?: Record<string, string | undefined>;
}
export interface WebRuntime {
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}
export function createWebRuntime(options: WebRuntimeOptions): Promise<WebRuntime>;
export function isRequestAllowed(
  profile: ApplicationProfile, method: string, pathname: string,
): boolean;
```

消费 client 类型与默认连接值；`/instrumentation` 公开现有 registerOutboundInstrumentation。`/vite` 公开 `createApplicationPlugins(options?: { appId?: "dikw-web" | "dikw-mbweb"; profile?: ApplicationProfile }): Plugin[]`，返回前置 profile middleware 与现有两个 sidecar 插件；缺省保持工作台兼容。Plugin 是 Vite 类型，Vite 为可选 peer，生产 `/runtime` 不导入 `/vite`。

- [x] 迁移现有 OIDC/Core proxy/Agent/Web job 外部行为测试，添加 profile 公共策略测试，先运行验证不存在新入口或 MB 限制时失败。

```ts
import { expect, it } from "vitest";
import { isRequestAllowed } from "@opendikw/web-server/runtime";

it.each([
  ["POST", "/v1/lint/apply"],
  ["POST", "/agent/sessions/a/proposals/p/confirm"],
  ["GET", "/v1/tasks"],
  ["POST", "/v1/new-admin-operation"],
])("rejects management capability %s %s for MB", (method, path) => {
  expect(isRequestAllowed("mbweb", method, path)).toBe(false);
});
it("preserves the existing MB upload pipeline", () => {
  expect(isRequestAllowed("mbweb", "POST", "/v1/import")).toBe(true);
  expect(isRequestAllowed("mbweb", "POST", "/v1/ingest")).toBe(true);
  expect(isRequestAllowed("mbweb", "POST", "/v1/synth")).toBe(true);
});
```

- [x] 提取 createWebRuntime；import 时不监听端口、不读应用静态目录、不安装退出 hook。工作台入口显式初始化 instrumentation 后调用它；保留原 listen/error/SIGTERM 行为。env 注入必须传递到现有三个 config loader，不能只在接口上声明。
- [x] 实现 MB 白名单、统一路径处理、角色检查；列表逐项来自设计矩阵与代码实际调用闭包。禁止未知 API 落入 SPA fallback。Vite profile middleware 位于 `/v1` proxy 和 sidecar 之前，测试开发服务器同样拒绝管理接口。将 `DIKW_WEB_CORE_ID` 作为 MB 生产必需的非敏感部署标识，MB `/web/auth/me` 增加经过验证的 issuer/coreId；工作台旧响应保持兼容。
- [x] 给工具构建及 runner 传递 profile；MB 不注册维护 proposal tool、不输出维护提示；HTTP 拒绝 proposal 操作和管理 traces。增加从实际运行 runtime 发请求的测试：viewer/editor、允许的阅读/上传、禁止的管理操作、异常路径、旧 proposal、伪造 browser coreUrl/token。两个实例各自使用临时目录，交叉 Cookie 不能登录，用户 A/B 的 jobs/sessions 互不可读。
- [ ] 修 Docker workspace 安装顺序与生产复制；保留 instrumentation 早于 outbound 请求、ADK/SQLite 外部依赖和原有 HTTP wire shapes。执行打包后 Node 消费/standalone、OIDC、持久化重启、生产镜像 smoke，然后全 gate；提交 `refactor(server): extract shared runtime with application profiles`。

**#205 必须保留的测试：** 有效签名/issuer/aud/sub、单次并发刷新、rotated refresh token、活跃滑动、空闲超时、绝对上限、角色降级/失去角色、刷新失败删除、旧会话固定 TTL、退出竞态、凭证不进 Cookie/日志/响应。#204 保留 Web job 创建、跟随、取消的归属检查。此任务不复制或改写 sqlite schema。

## 任务 4 建立真实包消费与 npm 发布流水线

**实施状态（2026-10-04）：** PR #216 经维护者同意 gate-change、CI 与审查通过后已合并。三个候选包从干净 main 提交构建并通过真实 tarball 独立消费；npm 登录 helebest、用户创建 opendikw 后的 owner 权限及认证发布 dry-run 已通过。实际发布被 npm E403 拒绝，需要账户 2FA。真实 registry 发布与下载 integrity 验证仍待完成。

**文件：**

- 创建：`scripts/{pack-shared-packages,verify-package-consumers,publish-shared-packages}.mjs`、`tests/package-consumers/{client,ui,server}/` 的独立 package/config/fixture。
- 创建：`.github/workflows/publish-packages.yml`，修改 `.github/workflows/ci.yml` 增加包消费检查；现有 required job 名保持不变。
- 修改：包 manifests 的 exports/files/dependencies/license/repository、根 npm scripts、共享包 README 与发布文档。
- 创建：`docs/shared-packages.md`，记录 scope、公共入口、候选/正式发布和本地联调方法。

**接口：** `npm.cmd run pack:shared` 显式构建、pack 到 `.tmp/shared-packages/`，输出 JSON 清单 `{ commit, version, packages: [{ name, version, tarball, integrity }] }`；`npm.cmd run verify:packages` 在临时消费目录安装这些 tarball，验证三个包及所有实际导出；`npm.cmd run publish:shared -- --tag next` 仅处理清单中的可发布包。

包清单验证器 `assertPublishablePackage(pkg: { private?: boolean; files?: string[]; dependencies?: Record<string, string> }): void` 在不允许发布或含跨目录依赖时抛出 Error，定义在 `scripts/pack-shared-packages.mjs` 并由相邻脚本测试消费；CLI 的打包动作与被 import 的验证函数分开。

- [ ] 添加 pack 验证脚本的负例：包内引用兄弟源码、缺声明、漏 CSS/字体、未声明依赖、夹带环境/sqlite/业务页面、版本不一致，都必须失败。包安装验证使用 Node/Vite 实际导入，不能只检查文件名。

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublishablePackage } from "./pack-shared-packages.mjs";

test("rejects a sibling source dependency before publishing", () => {
  assert.throws(() => assertPublishablePackage({
    private: false,
    files: ["dist", "README.md", "LICENSE"],
    dependencies: { "@opendikw/web-client": "file:../web-client" },
  }), /file:/);
});
```
- [ ] 建立显式构建/pack 清单。按 client→ui→server 顺序，在消费 fixture 中一次安装三个 tarball，使包间依赖也得到本次版本；fixture 不从仓库根 node_modules 借用未声明依赖。

```powershell
npm.cmd run build:packages
npm.cmd pack --workspace @opendikw/web-client --pack-destination .tmp/shared-packages --json
npm.cmd pack --workspace @opendikw/web-ui --pack-destination .tmp/shared-packages --json
npm.cmd pack --workspace @opendikw/web-server --pack-destination .tmp/shared-packages --json
npm.cmd run verify:packages
```

- [ ] 在公开 CI 加入这项检查，公开 CI 不 checkout MB。检查 npm scope/包名发布权限，确认所有 tarball 仅含共享能力，逐包附 MIT LICENSE 与来源说明。这个步骤依赖账户权限，但不阻塞前面的本地提取/pack 验证。
- [ ] 设置候选版本，同步三个包的内部依赖和消费应用依赖为同一个精确候选版本，在经过验证的 commit 上发布 `0.1.0-rc.1 --tag next --access public`。首次包创建完成后绑定 trusted publisher 到 `OpenDIKW/dikw-web` 的 `publish-packages.yml`，后续 job 仅有 `contents: read`、`id-token: write`，固定使用 GitHub-hosted runner、Node 24、npm `>=11.5.1`。发布 job 显式 build/verify，不能指望 prepack。
- [ ] 保存 registry 下载后的消费报告与 integrity；配置部分失败时只重试清单中的未发布包，已发布版本内容不同则失败。维护者能从精确版本安装三个候选包后提交 `build(packages): verify and publish shared npm packages`。

**验收：** 空目录安装 registry 候选包可运行 Node SDK、React reader、Node runtime；核心入口不需 DOM；控件不下载 reader 重依赖；runtime 不引入 React；完整工作台 gate 仍通过。包的 app 源码依赖和客户资产扫描通过。

## 任务 5 建立私有 MB 应用及独立配置

**实施状态（2026-10-04）：** 私有兄弟仓库已核实 Private，独立应用与显式迁移导入已提交到草稿 PR OpenDIKW/dikw-mbweb#1（最新 dd49eff）。本地真实候选 tarball 安装下，lint/format/types、21 文件 98 项单测、覆盖率、生产构建、6 条浏览器流程与 bundle 通过；三轮独立审查的有效问题已修复。已准备私有镜像发布 workflow 并通过 YAML/Bash 语法检查，尚未执行。未提交 file/workspace 依赖或伪造 lockfile；共享包发布前 npm ci、私有 hosted CI 与镜像验收仍无法完成，草稿不能合并。初始 CI/gate 和镜像 workflow 文件触发维护者 gate-change 要求。

**文件：**

- 新仓库根：package.json/lockfile、.npmrc、tsconfig、Vite/ESLint/Prettier/Vitest/Playwright 配置、index.html、Dockerfile、docker-compose.yml、.env.example、.gitignore、README、CLAUDE、CHANGELOG 与私有 CI。
- 创建：`src/main.tsx`、`src/App.tsx`、`src/models/{paper,note}.ts`、`src/config/{auth,connection,theme,storage}.ts`、`src/features/{research,notes,upload,settings}/`、`src/styles/mb.css`、`server/main.ts`。
- 迁移：现有 `src/mb` 的业务代码与 tests，以及实际覆盖 MB 的 e2e 场景；保留原始提交 `b7df6af` 与迁移时最新 commit 的来源记录。
- 创建：`tests/e2e/{research,notes,auth-isolation}.spec.ts`、`src/config/storage.test.ts`、`scripts/check-bundle.mjs`、私有 gate 完整性脚本/配置。

**接口：** 消费候选三个 npm 包及任务 3 的 MB profile。MB 自己定义 CurrentPaper/MbNote/UploadStage；notes 业务编排仍消费 DikwClient。新增 `storageNamespace(input: { issuer: string; subject: string; coreId: string }): Promise<string>`，通过 Web Crypto 得到 `dikw-mbweb.v1.<stable hash>`，不在 key 中存 token；退出/用户变化后 App 清空当前内存状态。工作台旧存储 key 保持。

- [ ] 创建前检查兄弟目录实际状态，核实组织 repo 是否已存在；已有仓库则检查 visibility 和内容，不能覆盖。创建时显式 private 并复核。目录写入遵守当前工作区权限，不通过其他目录间接写入；新仓库初始分支记录迁移来源，不复制公开仓库整份 `.git`。
- [ ] 建立应用与 tests，失败场景为“仅访问 MB 的 `/` 即可看到论文库，不依赖工作台 hash 或设置页面”；迁移现有研究、问答、笔记测试，更新实际 imports。

```ts
import { expect, it } from "vitest";
import { storageNamespace } from "./storage";

it("keeps browser records separate when the user or core changes", async () => {
  const a = { issuer: "https://iam.invalid", subject: "user-a", coreId: "base-a" };
  const original = await storageNamespace(a);
  expect(await storageNamespace(a)).toBe(original);
  expect(await storageNamespace({ ...a, subject: "user-b" })).not.toBe(original);
  expect(await storageNamespace({ ...a, coreId: "base-b" })).not.toBe(original);
});
```

```tsx
import { AgentClient } from "@opendikw/web-client/agent";
import { DikwClient } from "@opendikw/web-client/core";
import { useAuth } from "@opendikw/web-ui/auth";
import { MarkdownView } from "@opendikw/web-ui/reader";
// 业务模型从本仓库 src/models 引入，公共包不得反向引用这些模型。
```

- [ ] 实现独立 bootstrap、research/notes/settings 路由和品牌配置；生产 Core 同源，连接错误去 MB 诊断入口，401 去登录、403 显示权限不足，不提示用户修改生产 Core token。本地开发显式无鉴权时使用 MB 自有连接配置。
- [ ] 实现用户/Core 分区与身份切换清理；笔记和论文别名使用同一分区，身份与异步 namespace 就绪前不加载。切换时取消旧分区读取/请求，测试迟到结果不会写到新用户。翻译/转换缓存也接入应用提供的分区 cache 实例，避免不同身份共享浏览器内容；公开工作台保留原 cache 默认行为。验证账号 A 的笔记/别名不会显示给 B，换 Core 不带入旧笔记，返回 A/旧 Core 可恢复其数据。
- [ ] 实现薄 server 入口，固定 `appId: "dikw-mbweb"`、`profile: "mbweb"`，从独立环境加载配置；默认开发端口 `4322`，生产容器内部仍用 `4321`。Docker 只安装 registry 包，私有 CI 只 checkout MB；将 GHCR 镜像明确设为 private。保留 npm ignore-scripts 与原生 SQLite 验证，提交 `feat(app): establish standalone private MB application`。

**空克隆验收命令：** `npm.cmd ci`、`npm.cmd run verify`、`npm.cmd run check:bundle`、`npm.cmd run check:gate`、`docker build -t dikw-mbweb:verify .`。执行目录必须只含 MB 仓库，不能挂载 sibling web；先用候选包完成独立消费证据。

## 任务 6 建立浏览器数据迁移桥

**实施状态（2026-10-04）：** 旧应用显式导出和未来有限迁移页已实现，旧业务入口继续可用。私有导入已在草稿 PR #1 中，两端真实不同 origin 的 Chromium 导出/重复导入/刷新/别名/旧 storage 保留及无 Core POST 流程已通过；公开迁移分支正完成最终门禁和 PR。正式包 0.1.0 发布与应用依赖切换仍待 registry/镜像验收。

**文件：**

- 工作台创建：`src/migrations/legacyMbExport.ts`、`src/migrations/LegacyMbMigration.tsx`、对应测试与 `tests/e2e/legacy-mb-migration.spec.ts`。
- 工作台修改：branding/config 中增加 `mbWebUrl` 的可选部署配置，当前 MB 添加导出入口；最终 main 的旧 hash 处理由任务 7切换。
- MB 创建：`src/features/migration/{schema,import,MigrationPanel}.ts/tsx`、对应 tests 和 e2e；配置入口接入导入/导出按钮。
- 文档：两应用 migration/deployment 文档、迁移测试清单。

**接口：** 两端独立实现固定迁移协议；导出端不依赖私有业务模型。

```ts
export interface LegacyMbExportV1 {
  schema: "dikw-mbweb-migration";
  version: 1;
  notes: unknown[];
  paperNames: Record<string, string>;
}
```

协议文件只含笔记与别名，不含连接 token、登录凭证或缓存。MB 的 `parseMigration(text: string): LegacyMbExportV1` 校验协议；`mergeNotes(existing: MbNote[], imported: MbNote[]): MbNote[]` 按 nid 合并，目标已有 nid 优先，不静默覆盖。

- [ ] 写失败测试：空/损坏 storage、旧 schema 漂移、重复 nid、目标数据已存在、重复导入、超大文件、退出切换身份、旧 Wisdom 路径保持、导入过程无网络写入。限制迁移文件 `10 MiB`、笔记 `10,000` 条，超限保留原数据并说明原因。

```ts
import { expect, it } from "vitest";
import type { MbNote } from "../../models/note";
import { mergeNotes } from "./import";

it("preserves target notes and imports a missing note exactly once", () => {
  const existing = [{ nid: "a", type: "thought", quote: "", txt: "new", src: "",
    srcType: "", tags: [], ts: 1 }] satisfies MbNote[];
  const incoming = [{ ...existing[0], txt: "old" }, { ...existing[0], nid: "b" }];
  const once = mergeNotes(existing, incoming);
  expect(once.map((note) => note.nid)).toEqual(["a", "b"]);
  expect(once[0].txt).toBe("new");
  expect(mergeNotes(once, incoming)).toEqual(once);
});
```

- [ ] 实现旧站点 exporter，读取两组固定 legacy key，以 Blob/download 保存 JSON；错误不删原数据。迁移组件只在旧入口或显式迁移操作时加载，公共代码不导入 MbApp、MbNote 或论文业务组件。
- [ ] 实现私有 importer，显示文件统计、当前目标用户/Core，由用户选择导入；保留目标/来源路径与 Wisdom 关联。没有用户标识的 legacy 数据只在显式导入时归入当前分区；不自动写入 Wisdom，不自动传输到新域名。
- [ ] 在两个不同 origin 的真实浏览器中导出再导入，验证笔记、论文别名、重复导入和刷新后的持久状态；原 storage 仍存在。该阶段旧 MB 页面继续可用。
- [ ] 正式候选通过两应用验收后发布共享包 `0.1.0`，把 MB 的候选依赖切到精确正式版本、更新 lockfile并重跑 verify/镜像 smoke；分别提交 `feat(migration): export legacy MB browser data` 与 `feat(migration): import MB notes and paper names`。

## 任务 7 移除公开仓库中的 MB 业务页面

**实施状态（2026-10-05）：** 公开切换已在 `codex/remove-legacy-mb-application` 实现，18 个旧业务源码与测试文件已删除，原导出损坏数据断言保留在迁移页测试。新版迁移入口、静态/模块/sourcemap 边界检查完成真实失败回归与修复，三轮独立审查通过。独立 WSL 安装通过全部验证阶段：1296 项测试、62 条浏览器流程、三个独立包消费者及构建预算；两条原有 opt-in live 测试未启用，原测试限时、重试和预算不变。私有 `0.1.4` 最终镜像已通过真实登录、损坏数据保护、SQLite 备份/重启和已发布 `0.1.3` 回退验收。公开真实 UI、最终 PR 与 CI 仍在收尾。

**文件：**

- 修改：`src/main.tsx`、App routing、README、CLAUDE、CONTEXT、docs/core-contract、UI/Agent/deployment 文档、CHANGELOG、Docker/CI release 必要配置。
- 删除：已成功迁移的 `src/mb` 业务源码、tests、业务资产，以及仅服务 MB 的公开 mockup/demo；先做仓库全文搜索确认资产，不删除通用设计资料。
- 保留：任务 6 的有限 migration bridge；共享包与工作台页面。
- 新增：英文 `docs/adr/0007-application-repository-boundaries.md`、迁移清单最终记录、公开产物检查脚本。

**接口：** 工作台默认只启动管理应用；旧 `#MB-Web` 启动有限迁移页并提供已配置的新 MB 地址。公共包入口保持 `0.1.0` 契约，MB 使用同一正式发布批次。

- [x] 先添加浏览器失败测试：管理入口正常；旧 hash 展示迁移与导出；新 MB URL 未配置时仍能导出并看到说明。源码/包/产物检查针对 MB 页面、模块与资产，不用“任何 MB 字符串都禁止”的规则误杀兼容迁移桥。

```ts
import { expect, test } from "@playwright/test";

test("keeps the old MB link usable for migration", async ({ page }) => {
  await page.goto("/#MB-Web");
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出旧笔记与论文别名" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传论文" })).toHaveCount(0);
});
```

迁移页延续旧 MB 的中文界面，标题与按钮使用此测试文案；当前旧 MB 界面首次跑这个测试必须失败。
- [x] 将 main 对 MbApp 的 import/选择替换为懒加载 LegacyMbMigration，移除已迁移业务代码与孤立 imports。删除前核实私有 CI、正式包 registry 安装与 MB 镜像均已通过。
- [x] 完成测试迁移清单：每个公开删除的业务测试对应私有测试文件/通过的 commit；通用测试留在公共包。保持原发现配置、coverage/bundle 预算，不跳过失败测试。公开门禁需通过已授权的可见 `gate-change` 标签记录本次私有迁移。
- [x] 公开产物检查覆盖 `src/mb`/MbApp/PaperLibrary/QaPanel/NotesView 对应模块、业务 demo/assets 和 sourcemap 来源；共享 tarball 检查不含客户业务代码。有限迁移页是明确保留项，报告注明。
- [ ] 完整工作台 verify、bundle、gate、安全/镜像 checks 与 MB regression 再通过；独立审查，处理 CI/review 后合并 `refactor(app): remove embedded MB application from workbench`。按应用版本规则 bump，并保留兼容说明与正式包版本。

## 任务 8 双应用生产验证与切换

**实施状态（2026-10-05）：** 隔离 Core 0.6.8 的授权与读取、真实 Casdoor 双 client/SSO/logout、#204/#205 会话/角色边界、实际 Wisdom 写入与归档同步已验收。真实 MiniMax 双语翻译与问答沿用此前独立记录；`0.1.4` 不冒称重跑提供商问答。npm 三包正式 `0.1.0`、私有独立安装/CI/GHCR、最终 digest 的 SQLite 备份/重启与已发布旧镜像回退均通过。用户后续明确退役私有 Settings/导入导出，公开旧数据只提供保留原字节的本地备份。公开最终 PR/CI/真实 UI 仍在收尾；完整 Core 导入→ingest→synth 仍未验证，隔离 Core 缺提供商凭证，现有 embedding 密钥的服务商正在向用户确认。

**文件与记录：** 两仓部署文档、私有 MB `docker-compose.verify.yml`、真实集成验证脚本、镜像/包/commit 验收记录、回退操作说明。记录不包含凭证或客户正文。

**前置条件：** 落实实际域名、Casdoor 管理权限、npm scope、private repo/镜像访问权限、Docker daemon 和测试凭证；两套部署连接已确认的同一个 Core 知识库。使用测试知识库和测试用户；真实 LLM 成本只用于必要验收。当前环境 Docker CLI 存在但 daemon 曾未运行，实施时重新核实。

- [ ] 设置两个不同 origin 的应用、两个 OIDC client/回调地址、独立 secret/角色映射/volume；两套 BFF 配置同一个 Core URL/知识库和对应的同一个公开逻辑 coreId，各自在服务端持有连接凭证。工作台容器与 MB 容器可以都监听内部 4321，开发宿主机端口分别为 4321、4322。
- [ ] 验证实际登录与应用权限：允许的用户分别登录，未授权用户不可用；登录工作台后访问 MB 的 SSO 体验正确，Cookie 不跨应用复用；viewer/editor 控件与外部 HTTP 都受限。退出一应用不允许该应用旧会话恢复；是否影响 IdP/另一应用以实际 IdP logout 行为记录，不承诺“只退出当前应用”。
- [ ] 在真实 Core 上跑论文导入→ingest→synth→读取→双语→问答→笔记 Wisdom 流程；验证 MB 导入的数据可在工作台管理，工作台管理后的数据可在 MB 读取。验证两个用户的会话与 Web jobs 隔离，以及 MB 无维护工具/确认入口。共用 Core 的内容共享和整库处理按设计记录，不当成用户数据隔离通过。
- [ ] 用确定性短时间配置验证 #205 的活跃续期、空闲、绝对上限、角色同步/降级、刷新失败和退出竞态；使用签名的 fake IdP 覆盖时间与并发边界，再用真实 Casdoor 验证 discovery、签名、refresh/角色配置。UI 两套分别做亮暗主题、控制台、LCP/CLS 与可访问性回归，目标 CLS `<=0.1`、accessibility `>=0.9`，不新增长期违规。
- [ ] 备份 Core 和两个 volume，记录 digest/版本；先上线迁移出口和新 MB，确认用户可迁移后切换旧 hash。演练分别回退工作台/MB 镜像和 lockfile，确认持久数据可读、不删除数据、不覆盖包版本。两个应用全部验收项有本次证据后完成交付。

## 完成定义

| 验收项 | 必须提供的证据 |
| --- | --- |
| 私有与独立性 | MB GitHub repo 和镜像 visibility 复核；单独 checkout 的 CI/Docker 构建 |
| 可复用与包完整 | 三个 npm 正式版本、tarball 清单与 integrity；独立 Node/React/production 消费 |
| 产品行为 | 两套应用实际浏览器流程、迁移的 tests 清单、控制台/主题/字体/阅读器报告 |
| 能力与会话边界 | 双 profile HTTP、Agent tool、用户 A/B、跨应用 Cookie、#204/#205 回归 |
| 浏览器数据保留 | 按用户后续范围：旧 origin 显式本地备份不改写原字节，私有帐号笔记/别名保留；退役的导入 UI 不恢复，无自动 Wisdom 重写 |
| 门禁保持 | 两仓 verify/bundle/gate；公开必需检查名不变，合理配置变化有 gate-change 证据 |
| 生产与回退 | 真实 Core/Casdoor 集成、数据库重启、镜像摘要、备份与回退演练 |

应用拆分完成不以“文件已移动”判定，也不以历史会话/本地缓存被删除来换取验证通过。未运行的真实集成标记为未验证，并保留已经通过的确定性证据。


## 2026-10-04 问答范围与发布进展

- 维护者确认论文问答默认仅使用当前论文，跨论文另设显式入口。共享服务增加创建时绑定的页面路径范围，后续消息与本地改名不能改变范围；私有 MB 保留两种模式的独立历史。
- 范围是回答的证据选择，不是共享 Core 的用户 ACL。当前论文模式仅暴露 health 与固定 read_page，跨论文模式保留既有 mbweb profile 能力。
- 首个 rc.1 批次已实际发布到公开 npm 并完成 registry 字节与独立消费者验证。三个 Trusted Publisher 均已获 owner 授权并在 npm 页面确认；rc.2 批次已经由 GitHub OIDC 实际发布，并通过 registry 字节和独立消费者验证。
- 私有 PR 的发布中删除笔记与论文范围两项远程审查已复现，正在完成修复验收。私有门禁维护者判断、镜像与正式版本验收仍待完成，公开 MB 业务入口继续保留。

## 2026-10-04 候选验收与正式版本准备

- 私有初始 PR #1 已合并，最终 CI、独立 registry clone、真实迁移、授权 Core 阅读及 Wisdom 写入/归档恢复验证通过。
- 候选镜像的 Debian 安全更新已通过修复版本及真实登录会话、阅读器、SQLite 备份/重启验证。安全修复 PR #2 已合并，合并提交 d7dc421 的 main CI 37203240889 已通过；私有 GHCR 发布和最终 digest 验收仍待完成。
- 本次准备公开共享包正式 cohort 0.1.0，正式 npm 发布、私有精确正式依赖与最终镜像仍未完成，旧公开 MB 业务入口继续保留。
- 门禁已补真实重命名和发现目录回归；实际 coverage.exclude 不再误当 test.exclude。Windows 子进程启动有波动，WSL Linux 原有 5 秒限时下 41 项专项测试通过。完整公开验收与独立审查仍待本次执行。

- 正式版发布准备的远程审查指出 Playwright 条件 testDir/default 分支和 testIgnore 的发现判定尚不完整。本次未移动或删减任何现有浏览器 spec，运行时/API 与 rc.2 一致，因此该既有盲点明确延期至公开业务清理之前完善；不得据此宣称门禁发现覆盖完整。完整本地门禁现在也已在 WSL 全部通过。

## 2026-10-04 正式发布与跨会话收尾

- 公开 PR #219 已合并至 `165ed9c`，正式 npm 工作流 `37207050219` 全绿；三个包实际发布为 `0.1.0`，`latest`、registry 字节及独立消费者均已验收。工作台应用 Release `dikw-web-v0.11.3` 已发布。
- 用户将私有交付交接给 `mbweb-work` 会话，那里拥有私有目录操作权限；公开会话只读其证明并负责公开仓库，避免两个会话同时修改私有文件。私有 PR #3 已合并为 `0160a4f`，精确正式 registry 依赖、140 项测试和七条 Chromium 流程已通过；最终私有镜像/回退验收仍在该会话推进。
- 公开门禁补齐默认条件分支、ignore、quoted/spread/hidden-path 和默认 Vitest 排除，并在独立审查后补三类无法解析的发现配置拒绝规则；真实 Git 回归先红后绿，62 项专项检查通过。公开 Linux 独立安装完成全部验证阶段：1309 项测试、58 条 Chromium 流程、三个独立消费者及构建预算全绿；生产审计无 high/critical。两条原有 opt-in live 测试未启用，测试限时/断言未变。Hosted CI 和远程审查仍待本次 PR，旧业务入口和源码继续保留。
- 公开 PR #220 的第三轮独立（远程）审查指出 Playwright 依赖目录遍历和未知环境条件的遗漏；两个真实 Git 回归先红后绿，补上显式 testDir/CI 正向保护后共 66 项门禁回归通过。最终源码的全量验证与 hosted CI 另行记录，不用早一版 1309 项结果替代。
- 最终公开源码已在独立 Linux 安装完成 1313 项测试、58 条零重试浏览器流程、三个消费者、构建预算和 high+ 审计；精确结果见 `docs/verification/2026-10-04-default-test-discovery.md`。私有最终源码 `42dc43c` 的 main CI 与发布 run `37213165453` 已全绿，私有 digest `sha256:d91e25436880e6dfd0431908211942e56ec9d0df7ddaa879959f7db8107968d6` 实际拉取及登录、阅读、主题切换、双 SQLite 备份重启、旧安全镜像回退/恢复均通过；公开会话已只读核查关联、精确 CI/发布和明暗截图。

## 2026-10-05 最终业务入口切换

- 用户在 `mbweb-work` 明确退役私有 Settings 和导入导出，仅保留用户名、退出登录和主题。私有 PR #6 与 `0.1.3` 镜像已交付；公开迁移说明同步为只读本地备份，不再承诺私有导入入口。原双 origin 迁移验收保留为历史，已退役功能不恢复。
- 最终测试映射发现原公开 `damaged-notes.test.tsx` 未迁移，私有损坏笔记告警阻断了整页论文阅读。已通过获授权的跨会话工具交接；全部原有断言保留，真实红→绿，PR #7 合并为 `701fdbf`，精确 main CI `37218183657` 成功。发布 `37218360516` 和最终 `0.1.4` digest `sha256:68c2f573087469a5c34780cb56d2a92f1c02408acb2f7ab0f23c96de9620de42` 已独立核验；真实 Casdoor/Core、损坏存储保护、SQLite 备份/重启、已发布 `0.1.3` digest 回退再恢复均通过。[永久验收证明](https://github.com/OpenDIKW/dikw-mbweb/pull/7#issuecomment-5982327255)。
- 公开待交付应用版本为 `0.12.0`，三共享包仍精确 `0.1.0`，不重发既有版本。旧 hash 初次打开不探测鉴权；跨工作台/备份入口重载文档隔离旧 probe 和全局401处理器，普通工作台 hash 保持 SPA。初次迁移页缺失失败、独立审查两个红例和当前全量本地结果均有独立记录；最终 hosted CI 尚未运行。
- 构建检查有限的原业务路径、组件、静态资产及 sourcemap（包括 Vite 直接复制的 public map）。保留通用设计资产、共享 profile 和本地备份协议。Vite extensionless TS import 的未来 native-loader 告警已审查为非当前阻断；当前加载器和类型检查通过。
