// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DikwClient } from "./client.js";
import { buildImportBundle, buildTar, gzip, sha256HexString } from "../import/import-bundle.js";
import { readTar } from "../import/tar-reader.js";

afterEach(() => vi.unstubAllGlobals());

describe("DikwClient safe import", () => {
  it("protects attachments when an active Core source uses a local absolute reference", async () => {
    const bundle = await buildImportBundle([
      new File(["# New\n![Diagram](shared.png)"], "New.md"),
      new File(["replacement"], "shared.png"),
      new File(["# Plain source"], "Plain.md"),
    ]);
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") {
        const manifest = JSON.parse(String((init.body as FormData).get("manifest")));
        expect(manifest.packages.map((pkg: { id: number }) => pkg.id)).toEqual([1]);
        return Response.json({ committed: [1], rejected: [] });
      }
      if (String(url).includes("/pages/sources/"))
        return Response.json({
          path: "sources/report.md",
          body: "# Existing\n![Existing](/srv/dikw/sources/shared.png)",
          assets: [],
        });
      return Response.json([
        { path: "sources/report.md", hash: "old", active: true, layer: "source" },
      ]);
    });
    vi.stubGlobal("fetch", fetchFn);
    const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
    expect(result.committed).toEqual([1]);
    expect(result.rejected[0].code).toBe("source_asset_scope_unknown");
    expect(result.rejected[0].detail).toEqual({
      md_path: "sources/new.md",
      asset_path: "sources/shared.png",
      existing_path: "sources/report.md",
      original_ref: "/srv/dikw/sources/shared.png",
    });
  });
  it("rejects remaining packages when a conflicting archive cannot be safely decoded", async () => {
    const bundle = await buildImportBundle([
      new File(["# Existing path"], "Report.md"),
      new File(["# Fresh"], "Fresh.md"),
    ]);
    const payload = new Blob([bundle.payload, new Uint8Array(512)]);
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json([{ path: "sources/report.md", active: true, hash: "old", layer: "source" }]),
    );
    vi.stubGlobal("fetch", fetchFn);
    const result = await new DikwClient().importBundle(payload, bundle.manifestJson);
    expect(result.committed).toEqual([]);
    expect(result.rejected.map((entry) => entry.code)).toEqual([
      "source_path_exists",
      "unsupported_safe_import_archive",
    ]);
    expect(fetchFn.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it("preserves Core-compatible gzip padding when no source path conflicts", async () => {
    const bundle = await buildImportBundle([new File(["# Fresh"], "Fresh.md")]);
    const payload = new Blob([bundle.payload, new Uint8Array(512)]);
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== "POST")
        return Response.json([
          { path: "sources/old.md", active: true, hash: "old", layer: "source" },
        ]);
      expect(await ((init.body as FormData).get("payload") as Blob).arrayBuffer()).toEqual(
        await payload.arrayBuffer(),
      );
      return Response.json({ committed: [0], rejected: [] });
    });
    vi.stubGlobal("fetch", fetchFn);
    expect((await new DikwClient().importBundle(payload, bundle.manifestJson)).committed).toEqual([
      0,
    ]);
    expect(fetchFn.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });
  it("protects a Core project-root asset even when new packages introduce a sibling candidate", async () => {
    const image = (path: string) => {
      const file = new File(["replacement"], "shared.png");
      Object.defineProperty(file, "webkitRelativePath", { value: `V/${path}` });
      return file;
    };
    const bundle = await buildImportBundle([
      new File(["# Root replacement\n![Root](shared.png)"], "New.md"),
      new File(["# Sibling candidate\n![Sibling](paper/sources/shared.png)"], "Decoy.md"),
      image("shared.png"),
      image("paper/sources/shared.png"),
    ]);
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") return Response.json({ committed: [0], rejected: [] });
      if (String(url).includes("/pages/sources/"))
        return Response.json({
          path: "sources/paper/report.md",
          body: "# Existing\n![Existing](sources/shared.png)",
          assets: [],
        });
      return Response.json([
        { path: "sources/paper/report.md", hash: "old", active: true, layer: "source" },
      ]);
    });
    vi.stubGlobal("fetch", fetchFn);
    const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
    expect(result.committed).toEqual([]);
    expect(result.rejected.map((entry) => entry.code)).toEqual([
      "source_asset_exists",
      "source_asset_exists",
    ]);
    expect(result.rejected[0].detail?.asset_path).toBe("sources/shared.png");
    expect(fetchFn.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it("preserves a Core-compatible directory archive when no source path conflicts", async () => {
    const bundle = await buildImportBundle([new File(["# Fresh"], "Fresh.md")]);
    const directory = buildTar([{ archivePath: "sources/", data: new Uint8Array() }]).slice(0, 512);
    directory[156] = 0x35;
    directory.fill(0x20, 148, 156);
    const checksum = directory
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0");
    directory.set(new TextEncoder().encode(checksum), 148);
    directory[154] = 0;
    const regular = new Uint8Array(
      await new Response(
        bundle.payload.stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const tar = new Uint8Array(directory.length + regular.length);
    tar.set(directory);
    tar.set(regular, directory.length);
    const payload = await gzip(tar);
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method !== "POST")
          return Response.json([
            { path: "sources/old.md", active: true, hash: "old", layer: "source" },
          ]);
        posted = true;
        expect(await ((init.body as FormData).get("payload") as Blob).arrayBuffer()).toEqual(
          await payload.arrayBuffer(),
        );
        return Response.json({ committed: [0], rejected: [] });
      }),
    );
    expect((await new DikwClient().importBundle(payload, bundle.manifestJson)).committed).toEqual([
      0,
    ]);
    expect(posted).toBe(true);
  });

  it.each(["![Diagram](shared.png)", "![[shared.png|Diagram]]"])(
    "protects existing shared assets referenced as %s",
    async (reference) => {
      const bundle = await buildImportBundle([
        new File([`# Old path\n${reference}`], "Report.md"),
        new File([`# New\n${reference}`], "New.md"),
        new File(["different image"], "shared.png"),
      ]);
      const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
        if (init?.method === "POST") return Response.json({ committed: [1], rejected: [] });
        if (String(url).includes("/pages/sources/"))
          return Response.json({
            path: "sources/report.md",
            body: `# Existing\n${reference}`,
            assets: [],
          });
        return Response.json([
          { path: "sources/report.md", hash: "old", active: true, layer: "source" },
        ]);
      });
      vi.stubGlobal("fetch", fetchFn);
      const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
      expect(result.committed).toEqual([]);
      expect(result.rejected.map((entry) => entry.code)).toEqual([
        "source_path_exists",
        "source_asset_exists",
      ]);
      expect(result.rejected[1].detail?.asset_path).toBe("sources/shared.png");
      expect(fetchFn.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    },
  );

  it("posts only safe packages and preserves their ids plus Core rejection detail", async () => {
    const bundle = await buildImportBundle([
      new File(["# Old path"], "Report.md"),
      new File(["# Fresh"], "Fresh.md"),
      new File(["# Server reject"], "Other.md"),
    ]);
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method !== "POST")
          return Response.json([
            { path: "sources/report.md", hash: "old", active: false, layer: "source" },
          ]);
        posted = true;
        const form = init.body as FormData;
        const manifest = JSON.parse(String(form.get("manifest")));
        expect(manifest.packages.map((pkg: { id: number }) => pkg.id)).toEqual([1, 2]);
        expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
          "sources/fresh.md",
          "sources/other.md",
        ]);
        const payload = form.get("payload") as Blob;
        const tar = new Uint8Array(
          await new Response(
            payload.stream().pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer(),
        );
        expect(readTar(tar).map((entry) => entry.archivePath)).toEqual([
          "sources/fresh.md",
          "sources/other.md",
        ]);
        return Response.json({
          committed: [1],
          rejected: [
            { id: 2, code: "manifest_sha256_mismatch", detail: { file: "sources/other.md" } },
          ],
        });
      }),
    );
    const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
    expect(posted).toBe(true);
    expect(result.committed).toEqual([1]);
    expect(result.rejected.map((entry) => entry.id)).toEqual([0, 2]);
    expect(result.rejected[1].detail).toEqual({ file: "sources/other.md" });
  });

  it("does not post when checking existing sources fails", async () => {
    const bundle = await buildImportBundle([new File(["# Paper"], "Paper.md")]);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchFn);
    await expect(
      new DikwClient().importBundle(bundle.payload, bundle.manifestJson),
    ).rejects.toThrow();
    expect(fetchFn.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("warns when the same body already exists under another filename", async () => {
    const bundle = await buildImportBundle([new File(["# Same paper\n"], "New name.md")]);
    const hash = await sha256HexString("# Same paper");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Response(
            JSON.stringify(
              init?.method === "POST"
                ? {
                    import_id: "new",
                    committed: [0],
                    rejected: [],
                    files_count: 1,
                    bytes: 20,
                    applied_at: "now",
                  }
                : [{ path: "sources/old-name.md", layer: "source", active: true, hash }],
            ),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
    expect(result.committed).toEqual([0]);
    expect(result.warnings).toEqual([
      {
        id: 0,
        code: "source_content_matches",
        detail: { md_path: "sources/new-name.md", existing_path: "sources/old-name.md" },
      },
    ]);
  });
  it("rejects a different paper at an existing source path without posting an overwrite", async () => {
    const bundle = await buildImportBundle([new File(["# Different paper\n"], "Report.md")]);
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            { path: "sources/report.md", layer: "source", active: true, hash: "old-hash" },
          ]),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchFn);
    const result = await new DikwClient().importBundle(bundle.payload, bundle.manifestJson);
    expect(result.committed).toEqual([]);
    expect(result.rejected).toEqual([
      {
        id: 0,
        code: "source_path_exists",
        detail: { md_path: "sources/report.md", existing_path: "sources/report.md" },
      },
    ]);
    expect(
      fetchFn.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method !== "POST"),
    ).toBe(true);
  });
});
