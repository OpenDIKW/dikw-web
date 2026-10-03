import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownView } from "@opendikw/web-ui/reader";
import { AuthContext, useCanEdit } from "@opendikw/web-ui/auth";
import { Button } from "@opendikw/web-ui/controls";

it("renders the public reader with the same sanitization boundary", () => {
  const { container } = render(
    <MarkdownView body={"# Paper\n\n<script>alert(1)</script>\n\n**Evidence**"} />,
  );
  expect(screen.getByRole("heading", { name: "Paper" })).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("strong")?.textContent).toBe("Evidence");
});

function PermissionButton() {
  return <Button disabled={!useCanEdit()}>Upload</Button>;
}

it("shares the application provider with public permission controls", () => {
  const { rerender } = render(
    <AuthContext.Provider value={{ enabled: true, user: { sub: "user" }, role: "viewer" }}>
      <PermissionButton />
    </AuthContext.Provider>,
  );
  expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  rerender(
    <AuthContext.Provider value={{ enabled: true, user: { sub: "user" }, role: "editor" }}>
      <PermissionButton />
    </AuthContext.Provider>,
  );
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
});
