import {
  createWebRuntime,
  isRequestAllowed,
  type WebRuntimeOptions,
  type WebRuntime,
} from "@opendikw/web-server/runtime";
import { registerOutboundInstrumentation } from "@opendikw/web-server/instrumentation";
const options: WebRuntimeOptions = {
  appId: "dikw-mbweb",
  profile: "mbweb",
  cwd: process.cwd(),
  env: {},
};
const runtime: Promise<WebRuntime> = createWebRuntime(options);
void runtime;
isRequestAllowed("mbweb", "GET", "/v1/health");
registerOutboundInstrumentation();
