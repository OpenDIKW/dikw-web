// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./gate";
import { extractRoles, requiredRole, resolveRole } from "./roles";
import { createSealer } from "./seal";
import { scrub } from "../web/scrub";

const PUBLIC_URL = "https://kb.example.com";

describe("createSealer property invariants", () => {
  const secretArb = fc.string({ minLength: 16, maxLength: 64 });
  const purposeArb = fc.string({ minLength: 1, maxLength: 24 });

  it("round-trips arbitrary JSON-safe payloads", () => {
    fc.assert(
      fc.property(secretArb, purposeArb, fc.jsonValue(), (secret, purpose, payload) => {
        const sealer = createSealer(secret, purpose);
        const sealed = sealer.seal(payload);
        // JSON.stringify normalizes -0 to 0; compare against the JSON round-trip value.
        expect(sealer.open(sealed)).toEqual(JSON.parse(JSON.stringify(payload)));
      }),
      { numRuns: 100 },
    );
  });

  it("rejects single-byte tampering, truncation, wrong secret, and wrong purpose", () => {
    fc.assert(
      fc.property(
        secretArb,
        secretArb,
        purposeArb,
        fc.jsonValue(),
        fc.nat(),
        (secret, otherSecret, purpose, payload, indexSeed) => {
          fc.pre(secret !== otherSecret);
          const sealer = createSealer(secret, purpose);
          const sealed = sealer.seal(payload);
          const raw = Buffer.from(sealed, "base64url");

          // Flip one byte anywhere in IV, auth tag, or ciphertext.
          const tampered = Buffer.from(raw);
          const idx = indexSeed % tampered.length;
          tampered[idx] ^= 0xff;
          expect(sealer.open(tampered.toString("base64url"))).toBeNull();

          // Truncate to strictly shorter than IV + tag.
          const truncated = raw.subarray(0, Math.min(raw.length - 1, 27));
          expect(sealer.open(truncated.toString("base64url"))).toBeNull();

          // Wrong secret or wrong purpose must never open the record.
          expect(createSealer(otherSecret, purpose).open(sealed)).toBeNull();
          expect(createSealer(secret, `${purpose}-other`).open(sealed)).toBeNull();
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe("roles property invariants", () => {
  const unsafeMethodArb = fc.constantFrom("POST", "PUT", "PATCH", "DELETE", "post", "delete");
  const safeMethodArb = fc.constantFrom("GET", "HEAD", "OPTIONS", "get");
  const segmentArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,16}$/);

  it("denies viewers on all non-allowlisted unsafe /v1/* writes", () => {
    const nonAllowlistedV1PathArb = fc
      .array(segmentArb, { minLength: 1, maxLength: 4 })
      .map((parts) => `/v1/${parts.join("/")}`)
      .filter((path) => path !== "/v1/retrieve" && path !== "/v1/doc/search");

    fc.assert(
      fc.property(unsafeMethodArb, nonAllowlistedV1PathArb, (method, pathname) => {
        expect(requiredRole(method, pathname)).toBe("editor");
      }),
      { numRuns: 150 },
    );
  });

  it("requires editor for /web/mineru/* (any method/slashes) and agent proposal confirms", () => {
    const slashesArb = fc.constantFrom("/", "//", "///");
    fc.assert(
      fc.property(
        fc.oneof(safeMethodArb, unsafeMethodArb),
        slashesArb,
        slashesArb,
        segmentArb,
        (method, s1, s2, tail) => {
          expect(requiredRole(method, `${s1}web${s2}mineru/${tail}`)).toBe("editor");
        },
      ),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(unsafeMethodArb, segmentArb, segmentArb, slashesArb, (method, sid, pid, s) => {
        expect(requiredRole(method, `${s}agent/sessions/${sid}/proposals/${pid}/confirm`)).toBe(
          "editor",
        );
      }),
      { numRuns: 100 },
    );
  });

  it("resolveRole gives editor precedence and returns null for disjoint roles", () => {
    const roleNameArb = fc.stringMatching(/^[a-z0-9_-]{1,12}$/);
    fc.assert(
      fc.property(
        fc.array(roleNameArb, { maxLength: 6 }),
        fc.array(roleNameArb, { maxLength: 4 }),
        fc.array(roleNameArb, { maxLength: 4 }),
        (userRoles, viewerRoles, editorRoles) => {
          const resolved = resolveRole(userRoles, { viewerRoles, editorRoles });
          const hasEditor = userRoles.some((r) => editorRoles.includes(r));
          const hasViewer = userRoles.some((r) => viewerRoles.includes(r));
          if (hasEditor) expect(resolved).toBe("editor");
          else if (hasViewer) expect(resolved).toBe("viewer");
          else expect(resolved).toBeNull();
        },
      ),
      { numRuns: 120 },
    );
  });

  it("extractRoles never returns disabled roles or roles owned by another organization", () => {
    const roleObjArb = fc.record({
      name: fc.stringMatching(/^[a-z0-9_-]{1,12}$/),
      owner: fc.constantFrom("org-a", "org-b"),
      isEnabled: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(roleObjArb, { maxLength: 10 }), (roleObjects) => {
        const extracted = extractRoles({ roles: roleObjects }, "roles[].name", "org-a");
        const expected = roleObjects
          .filter((r) => r.isEnabled && r.owner === "org-a")
          .map((r) => r.name);
        expect(extracted).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});

describe("safeReturnTo property invariants", () => {
  it("only ever returns a same-origin absolute path that cannot be protocol-relative", () => {
    const candidateArb = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc
        .array(fc.constantFrom("/", ".", "..", "\\", "%2e", "evil.com", "base", "#chat", "?a=1"), {
          minLength: 1,
          maxLength: 8,
        })
        .map((parts) => parts.join("")),
    );
    fc.assert(
      fc.property(candidateArb, (input) => {
        const result = safeReturnTo(input, PUBLIC_URL);
        if (result !== null) {
          expect(result.startsWith("/")).toBe(true);
          expect(result.startsWith("//")).toBe(false);
          expect(new URL(result, PUBLIC_URL).origin).toBe(PUBLIC_URL);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("scrub property invariants", () => {
  it("never leaves the full secret token in scrubbed output for tokens >= 5 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 40 }),
        fc.array(fc.string({ maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        (token, chunks) => {
          const message = chunks.join(token);
          const scrubbed = scrub(message, token);
          expect(scrubbed).not.toContain(token);
        },
      ),
      { numRuns: 120 },
    );
  });
});
