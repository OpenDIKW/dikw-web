import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { cx } from "./cx";
import { Field } from "./Field";
import { IconButton } from "./IconButton";

describe("cx", () => {
  it("joins truthy parts and drops falsy ones", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(cx()).toBe("");
  });
});

describe("Button", () => {
  it("defaults to the primary variant and type=button", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveClass("primary-button");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("renders the secondary and danger variants", () => {
    render(
      <>
        <Button variant="secondary">Clear</Button>
        <Button variant="danger">Cancel</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Clear" })).toHaveClass("secondary-button");
    const danger = screen.getByRole("button", { name: "Cancel" });
    expect(danger).toHaveClass("secondary-button");
    expect(danger).toHaveClass("secondary-button--danger");
  });

  it("appends extra className, forwards disabled and onClick, and honors an explicit type", () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" className="extra" disabled onClick={onClick} type="submit">
        Apply
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Apply" });
    expect(btn).toHaveClass("secondary-button");
    expect(btn).toHaveClass("extra");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("type", "submit");
  });
});

describe("IconButton", () => {
  it("wraps the icon-button class, maps label to aria-label, and defaults type=button", () => {
    render(
      <IconButton label="Refresh">
        <svg data-testid="icon" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn).toHaveClass("icon-button");
    expect(btn).toHaveAttribute("type", "button");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("appends call-site classes and forwards menu aria attributes", () => {
    render(
      <IconButton
        label="Session menu"
        className="agent-session__menu-trigger"
        aria-haspopup="menu"
        aria-expanded={false}
      >
        <svg />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Session menu" });
    expect(btn).toHaveClass("icon-button");
    expect(btn).toHaveClass("agent-session__menu-trigger");
    expect(btn).toHaveAttribute("aria-haspopup", "menu");
  });
});

describe("Field", () => {
  it("renders the label span and control, and maps modifiers to field--* classes", () => {
    const { container } = render(
      <Field label="Limit" small>
        <input aria-label="Limit" defaultValue="10" />
      </Field>,
    );
    const label = container.querySelector("label");
    expect(label).toHaveClass("field");
    expect(label).toHaveClass("field--small");
    expect(screen.getByText("Limit").tagName).toBe("SPAN");
    expect(screen.getByRole("textbox", { name: "Limit" })).toBeInTheDocument();
  });

  it("supports grow and an appended className", () => {
    const { container } = render(
      <Field label="Query" grow className="custom">
        <input aria-label="Query" />
      </Field>,
    );
    const label = container.querySelector("label");
    expect(label).toHaveClass("field");
    expect(label).toHaveClass("field--grow");
    expect(label).toHaveClass("custom");
  });
});
