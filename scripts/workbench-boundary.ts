import type { Plugin } from "vite";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Finite former business paths. The legacy exporter, server profile, shared
// readers and generic design assets intentionally remain public.
function assertPublicPath(path: string): void {
  const normalized = path.replaceAll("\\", "/").split("?")[0];
  if (
    /(?:^|\/)src\/mb(?:\/|$)/i.test(normalized) ||
    /(?:^|\/)(?:MbApp|PaperLibrary|PaperReader|ResearchWorkspace|QaPanel|NotesView|wisdom-sync|mb)(?:[.-][^/]*)?\.(?:[cm]?[jt]sx?|css|html|svg|png|jpe?g|webp)(?:\.map)?$/i.test(
      normalized,
    ) ||
    /(?:^|\/)(?:public|mockups)\/(?:mb|mbweb|mb-web)(?:\/|[.-])/i.test(normalized)
  )
    throw new Error(`MB business code must remain in the private application: ${path}`);
}

function inspectTree(path: string): void {
  if (!existsSync(path)) return;
  const directory = lstatSync(path);
  if (directory.isSymbolicLink())
    throw new Error(`Symlinks are not allowed in scanned trees: ${path}`);
  if (!directory.isDirectory()) throw new Error(`Expected scanned directory: ${path}`);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const metadata = lstatSync(child);
    if (metadata.isSymbolicLink())
      throw new Error(`Symlinks are not allowed in scanned trees: ${child}`);
    if (entry.isDirectory()) {
      if (!metadata.isDirectory()) throw new Error(`Directory changed during inspection: ${child}`);
      inspectTree(child);
    } else {
      assertPublicPath(child);
      // Vite copies publicDir directly; those maps never enter generateBundle.
      if (child.endsWith(".map"))
        inspectMap(JSON.parse(readFileSync(child, "utf8")) as SourceMapPaths);
    }
  }
}

interface SourceMapPaths {
  sourceRoot?: string;
  sources?: string[];
  sections?: { map: SourceMapPaths }[];
}
function inspectMap(map: SourceMapPaths): void {
  for (const source of map.sources ?? []) assertPublicPath(`${map.sourceRoot ?? ""}/${source}`);
  for (const section of map.sections ?? []) inspectMap(section.map);
}

export function workbenchBoundary(): Plugin {
  let root: string;
  return {
    name: "workbench-boundary",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      for (const directory of ["src", "public", "mockups"]) inspectTree(join(root, directory));
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        for (const item of Object.values(bundle)) {
          assertPublicPath(item.fileName);
          if (item.type === "chunk") {
            for (const id of item.moduleIds) assertPublicPath(id);
            if (item.map) inspectMap(item.map);
          } else if (item.fileName.endsWith(".map")) {
            inspectMap(JSON.parse(Buffer.from(item.source).toString("utf8")) as SourceMapPaths);
          }
        }
      },
    },
  };
}
