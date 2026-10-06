import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

export async function verifyUi(cwd) {
  // The consumer resolves its own Vite, React and package dependencies. Playwright
  // is the repository's test runner, not an application runtime dependency.
  const { build, preview } = await import(
    `${new URL(`file:///${cwd.replaceAll("\\", "/")}/`).href}node_modules/vite/dist/node/index.js`
  );
  await build({
    root: cwd,
    configFile: false,
    logLevel: "warn",
    build: { outDir: "controls-dist", rolldownOptions: { input: `${cwd}/controls.html` } },
  });
  const controls = readdirSync(`${cwd}/controls-dist/assets`).filter((name) =>
    name.endsWith(".js"),
  );
  const controlJs = controls
    .map((name) => readFileSync(`${cwd}/controls-dist/assets/${name}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(controlJs, /mermaid|echarts|node:sqlite|node:http/);
  await build({ root: cwd, configFile: false, logLevel: "warn" });
  const server = await preview({
    root: cwd,
    configFile: false,
    logLevel: "warn",
    preview: { host: "127.0.0.1", port: 0 },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    const fonts = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (/\.(woff2?|ttf)(\?|$)/.test(response.url())) fonts.push(response.status());
    });
    await page.route("**/v1/assets/figure", async (route) => {
      assert.equal(route.request().headers().authorization, "Bearer fixture-only-token");
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="green"/></svg>',
      });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("heading", { name: "Packed reader" }).waitFor();
    assert.equal(await page.locator("h2#results sup").textContent(), "*");
    assert.equal(await page.locator("p sup").textContent(), "18,19");
    assert.equal(await page.locator("p sub").textContent(), "2");
    assert.deepEqual(await page.locator(".markdown-table-wrap td").allTextContents(), [
      "10-3",
      "E. coli",
      "H2O",
      "kept",
    ]);
    assert.equal(await page.locator("td i").textContent(), "E. coli");
    assert.equal(
      await page
        .locator(".markdown-body")
        .textContent()
        .then((text) => text.includes("<sup>")),
      false,
    );
    await page.getByLabel("Query").focus();
    assert.notEqual(
      await page.getByLabel("Query").evaluate((input) => getComputedStyle(input).boxShadow),
      "none",
    );
    assert.equal(
      await page.getByRole("button", { name: "Upload", exact: true }).isDisabled(),
      true,
    );
    await page.locator(".mermaid-diagram svg").waitFor();
    await page.locator(".markdown-chart__canvas canvas").waitFor();
    await page.waitForFunction(() =>
      document.querySelector("img.markdown-image")?.src.startsWith("blob:"),
    );
    await page.evaluate(() => document.fonts.ready);
    assert.ok(fonts.length > 0, "KaTeX loads its published fonts");
    assert.ok(fonts.every((status) => status === 200));
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
