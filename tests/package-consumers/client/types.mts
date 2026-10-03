import { DikwClient, type DikwClientConfig } from "@opendikw/web-client/core";
import { AgentClient, type AgentClientOptions } from "@opendikw/web-client/agent";
import type {
  AuthState,
  PageReadResult,
  TaskHandle,
  AgentStreamEvent,
} from "@opendikw/web-client/types";
import { buildImportBundle, type BuildBundleOptions } from "@opendikw/web-client/import";
import { tryOpenDefaultCache } from "@opendikw/web-client/convert";
import { tryOpenDefaultTranslateCache } from "@opendikw/web-client/translate";
import { parseMarkdownDocument } from "@opendikw/web-client/document";
import { defaultServerUrl } from "@opendikw/web-client/connection";

export const config: DikwClientConfig = { baseUrl: defaultServerUrl };
export const client = new DikwClient(config);
export const agentConfig: AgentClientOptions = {};
export const agent = new AgentClient(agentConfig);
export const auth: AuthState = {
  enabled: true,
  user: { sub: "subject" },
  role: "viewer",
  issuer: "https://idp.example",
  coreId: "shared-base",
};
export const page = client.get<PageReadResult>("/v1/base/pages/sources/paper.md");
export type Protocol = TaskHandle | AgentStreamEvent;
export function archive(files: File[], options: BuildBundleOptions) {
  return buildImportBundle(files, options);
}
export const convert = tryOpenDefaultCache({ namespace: "partition" });
export const translate = tryOpenDefaultTranslateCache({ namespace: "partition" });
export const document = parseMarkdownDocument("# Consumer");
