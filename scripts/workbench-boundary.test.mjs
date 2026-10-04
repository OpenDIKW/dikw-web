import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { build } from "vite";
import { workbenchBoundary } from "./workbench-boundary";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dikw-workbench-boundary-"));
  roots.push(root);
  writeFileSync(join(root, "entry.js"), "export const app = 'workbench';");
  return root;
}
function compile(root, plugins = [], write = false) {
  return build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [workbenchBoundary(), ...plugins],
    build: {
      write,
      sourcemap: true,
      lib: { entry: join(root, "entry.js"), formats: ["es"] },
    },
  });
}
it("rejects the embedded business tree even when its modules are not imported", async () => {
  const root = fixture();
  mkdirSync(join(root, "src/mb"), { recursive: true });
  writeFileSync(join(root, "src/mb/MbApp.tsx"), "export const MbApp = null;");
  await expect(compile(root)).rejects.toThrow(/MB business/);
});
it("rejects a business component moved outside the former directory", async () => {
  const root = fixture();
  writeFileSync(join(root, "QaPanel.js"), "export const question = 'private';");
  writeFileSync(join(root, "entry.js"), "export { question } from './QaPanel.js';");
  await expect(compile(root)).rejects.toThrow(/MB business/);
});
it("rejects business assets copied to the public directory", async () => {
  const root = fixture();
  mkdirSync(join(root, "public/mbweb"), { recursive: true });
  writeFileSync(join(root, "public/mbweb/demo.html"), "<h1>private</h1>");
  await expect(compile(root)).rejects.toThrow(/MB business/);
});
it("rejects a sourcemap exposing business source paths", async () => {
  const root = fixture();
  await expect(
    compile(root, [
      {
        name: "map-fixture",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "injected.js.map",
            source: JSON.stringify({ sources: ["../src/mb/MbApp.tsx"] }),
          });
        },
      },
    ]),
  ).rejects.toThrow(/MB business/);
});
it("rejects a neutral-named public sourcemap that would copy business source into dist", async () => {
  const root = fixture();
  mkdirSync(join(root, "public"));
  writeFileSync(
    join(root, "public/neutral.js.map"),
    JSON.stringify({
      version: 3,
      sources: ["../src/mb/MbApp.tsx"],
      sourcesContent: ["private fixture implementation"],
    }),
  );
  await expect(compile(root, [], true)).rejects.toThrow(/MB business/);
});
it("rejects a neutral public symlink that Vite would copy from outside the scanned trees", async () => {
  const root = fixture();
  mkdirSync(join(root, "private-fixture"));
  writeFileSync(join(root, "private-fixture/neutral.js"), "export const privateBusiness = true;");
  mkdirSync(join(root, "public"));
  symlinkSync(join(root, "private-fixture"), join(root, "public/neutral"), "junction");
  await expect(compile(root, [], true)).rejects.toThrow(/symlink/i);
});
it("rejects a scanned directory that is itself a symlink", async () => {
  const root = fixture();
  mkdirSync(join(root, "private-fixture"));
  writeFileSync(join(root, "private-fixture/neutral.js"), "export const privateBusiness = true;");
  symlinkSync(join(root, "private-fixture"), join(root, "public"), "junction");
  await expect(compile(root, [], true)).rejects.toThrow(/symlink/i);
});
it("keeps the migration bridge, shared profile and generic design assets", async () => {
  const root = fixture();
  mkdirSync(join(root, "public"));
  mkdirSync(join(root, "mockups"));
  mkdirSync(join(root, "src/mb"), { recursive: true }); // Git does not track empty directories.
  writeFileSync(join(root, "public/opendikw-mark.svg"), "<svg/>");
  writeFileSync(
    join(root, "public/shared.js.map"),
    JSON.stringify({
      sources: ["../shared/reader.ts"],
      sourcesContent: ["mbweb shared reader profile"],
    }),
  );
  writeFileSync(join(root, "mockups/base-bilingual-reading.html"), "<h1>Reader</h1>");
  writeFileSync(
    join(root, "LegacyMbMigration.js"),
    "export const app = 'mbweb profile migration';",
  );
  writeFileSync(join(root, "entry.js"), "export { app } from './LegacyMbMigration.js';");
  await expect(compile(root)).resolves.toBeDefined();
});
