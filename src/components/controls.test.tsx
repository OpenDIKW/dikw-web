import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { cx } from "./cx";
import { Field } from "./Field";
import { FrontmatterChip } from "./FrontmatterChip";
import { IconButton } from "./IconButton";
import { SegmentedControl } from "./SegmentedControl";
import { SoftLabel } from "./SoftLabel";

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

describe("SoftLabel", () => {
  it("renders a span carrying the soft-label class with its children", () => {
    render(<SoftLabel>3 headings</SoftLabel>);
    const el = screen.getByText("3 headings");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveClass("soft-label");
  });

  it("appends extra className and forwards rest attributes", () => {
    render(
      <SoftLabel className="wiki-backlinks__layer" role="status" aria-live="polite">
        K
      </SoftLabel>,
    );
    const el = screen.getByText("K");
    expect(el).toHaveClass("soft-label");
    expect(el).toHaveClass("wiki-backlinks__layer");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });
});

describe("FrontmatterChip", () => {
  it("renders a plain chip span with its children", () => {
    const { container } = render(
      <FrontmatterChip>
        <strong>status</strong>
        active
      </FrontmatterChip>,
    );
    const el = container.querySelector("span");
    expect(el).toHaveClass("frontmatter-chip");
    expect(el).not.toHaveClass("frontmatter-chip--tag");
    expect(container.querySelector("strong")).toHaveTextContent("status");
  });

  it("adds the tag and source modifier classes", () => {
    render(
      <>
        <FrontmatterChip variant="tag">#alpha</FrontmatterChip>
        <FrontmatterChip variant="source">paper.pdf</FrontmatterChip>
      </>,
    );
    const tag = screen.getByText("#alpha");
    expect(tag).toHaveClass("frontmatter-chip");
    expect(tag).toHaveClass("frontmatter-chip--tag");
    const source = screen.getByText("paper.pdf");
    expect(source).toHaveClass("frontmatter-chip");
    expect(source).toHaveClass("frontmatter-chip--source");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ] as const;

  it("renders a labeled group of toggle buttons and exposes the active one via aria-pressed", () => {
    const { container } = render(
      <SegmentedControl
        value="light"
        options={options}
        onChange={() => {}}
        ariaLabel="Theme"
        settings
      />,
    );
    // The track is a named group so the aria-label is announced (a bare div
    // drops its name); each option is a toggle button carrying aria-pressed.
    const track = container.querySelector(".segmented-control");
    expect(track).toHaveClass("segmented-control--settings");
    expect(track).toHaveAttribute("role", "group");
    expect(track).toHaveAttribute("aria-label", "Theme");
    const active = screen.getByRole("button", { name: "Light", pressed: true });
    expect(active).toHaveClass("is-active");
    expect(active).toHaveAttribute("type", "button");
    const inactive = screen.getByRole("button", { name: "System", pressed: false });
    expect(inactive).not.toHaveClass("is-active");
  });

  it("calls onChange with the clicked option value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="light" options={options} onChange={onChange} ariaLabel="Theme" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });
});
