import React from "react";
import { createRoot } from "react-dom/client";
import { AuthContext, useCanEdit } from "@opendikw/web-ui/auth";
import { Button, Field } from "@opendikw/web-ui/controls";
import { MarkdownView } from "@opendikw/web-ui/reader";
import { useTheme } from "@opendikw/web-ui/theme";
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
import "@opendikw/web-ui/reader.css";

function Reader() {
  const canEdit = useCanEdit();
  const theme = useTheme({ storageKey: "consumer.theme" });
  return (
    <main>
      <Field label="Query">
        <input />
      </Field>
      <Button disabled={!canEdit}>Upload</Button>
      <Button onClick={() => theme.setPreference(theme.resolved === "dark" ? "light" : "dark")}>
        Theme
      </Button>
      <MarkdownView
        body={
          "# Packed reader\n\n$E=mc^2$\n\n```mermaid\ngraph LR\nA-->B\n```\n\n<details><summary>bar</summary>\n\n| Item | Value |\n| --- | --- |\n| A | 2 |\n| B | 3 |\n\n</details>\n\n![Evidence](figure.png)"
        }
        assets={[{ asset_id: "figure", original_paths: ["figure.png"], url: "/v1/assets/figure" }]}
        assetToken="fixture-only-token"
      />
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <AuthContext.Provider value={{ enabled: true, user: { sub: "reader" }, role: "viewer" }}>
    <Reader />
  </AuthContext.Provider>,
);
