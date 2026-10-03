export type ApplicationProfile = "workbench" | "mbweb";
export type ApplicationId = "dikw-web" | "dikw-mbweb";

/** Decode once before both authorization and dispatch. Reject ambiguous paths. */
export function normalizeRequestPath(pathname: string): string | null {
  try {
    if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
    const decoded = decodeURIComponent(pathname);
    if (
      decoded.includes("\\") ||
      [...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /%(?:2e|2f|5c|25|00)/i.test(decoded)
    )
      return null;
    if (decoded === "/") return decoded;
    const segments = decoded.slice(1).split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** MB's business API closure; roles are enforced separately by the auth gate. */
export function isRequestAllowed(
  profile: ApplicationProfile,
  method: string,
  pathname: string,
): boolean {
  if (profile === "workbench") return true;
  if (profile !== "mbweb") return false;
  const path = normalizeRequestPath(pathname);
  if (!path) return false;
  const verb = method.toUpperCase();
  const read = verb === "GET" || verb === "HEAD";
  if (!/^\/(?:v1|agent|web)(?:\/|$)/.test(path)) return read;
  if (path.startsWith("/v1")) {
    if (read)
      return /^\/v1\/(?:health|wisdom|base\/(?:pages(?:\/.+)?|wisdom)|assets\/.+|tasks\/[^/]+(?:\/(?:events|result))?)$/.test(
        path,
      );
    return (
      verb === "POST" &&
      ["/v1/retrieve", "/v1/import", "/v1/ingest", "/v1/synth", "/v1/base/wisdom"].includes(path)
    );
  }
  if (path.startsWith("/agent")) {
    if (path === "/agent/sessions") return read || verb === "POST";
    if (/^\/agent\/sessions\/[^/]+$/.test(path))
      return read || verb === "PATCH" || verb === "DELETE";
    return verb === "POST" && /^\/agent\/sessions\/[^/]+\/(?:messages|abort)$/.test(path);
  }
  if (path.startsWith("/web/auth/")) {
    return read
      ? /^\/web\/auth\/(?:me|login|callback|signed-out)$/.test(path)
      : verb === "POST" && path === "/web/auth/logout";
  }
  if (read) return /^\/web\/(?:mineru|translate)\/(?:health|jobs\/[^/]+(?:\/result)?)$/.test(path);
  return (
    verb === "POST" &&
    (path === "/web/mineru/convert" ||
      path === "/web/translate/submit" ||
      /^\/web\/(?:mineru|translate)\/jobs\/[^/]+\/cancel$/.test(path))
  );
}

/** Apply the same canonical URL at the Vite and production boundaries. */
export function canonicalRequestUrl(raw: string): string | null {
  const query = raw.indexOf("?");
  const path = normalizeRequestPath(query < 0 ? raw : raw.slice(0, query));
  if (!path) return null;
  return path.split("/").map(encodeURIComponent).join("/") + (query < 0 ? "" : raw.slice(query));
}
