import { randomUUID } from "node:crypto";
import { defaultResource, resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { version as packageVersion } from "../../package.json";

const DEFAULT_SERVICE_NAME = "dikw-web";

// service.instance.id identifies ONE running process; per OTel semantic
// conventions it must stay stable for the process lifetime. Generate it once at
// module load so repeated buildDikwResource() calls (later phases reuse the
// resource for metrics/logs) all report the same instance instead of splitting
// signals across distinct ids.
const SERVICE_INSTANCE_ID = randomUUID();

/**
 * The OTel Resource that identifies this sidecar in any exported telemetry
 * (traces now; metrics/logs in later phases). Without it, OTLP-exported spans
 * carry no service attribution.
 *
 * - `service.name` defaults to "dikw-web" but honors the standard
 *   `OTEL_SERVICE_NAME` env override (so a deployment can distinguish stages).
 * - `service.version` tracks package.json (inlined at build time).
 * - `service.instance.id` is a fresh UUID per process.
 *
 * Merged over `defaultResource()` so the SDK's own `telemetry.sdk.*` attributes
 * are preserved while our service identity takes precedence on collisions.
 */
export function buildDikwResource(): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: packageVersion,
      [ATTR_SERVICE_INSTANCE_ID]: SERVICE_INSTANCE_ID,
    }),
  );
}
