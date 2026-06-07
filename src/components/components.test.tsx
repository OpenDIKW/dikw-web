import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DikwClientError } from "../api/client";
import { EmptyState } from "./EmptyState";
import { MetricCard } from "./MetricCard";
import { Notice } from "./Notice";
import { StatusPill } from "./StatusPill";

describe("shared display components", () => {
  it("renders status tone and optional label", () => {
    render(<StatusPill status="succeeded" label="passed" />);
    expect(screen.getByText("passed")).toHaveClass("status-pill--ok");
  });

  it("renders error notices with API status and code", () => {
    const error = new DikwClientError({
      status: 404,
      code: "not_found",
      message: "Missing page",
    });
    render(<Notice title="无法读取页面" error={error} />);
    expect(screen.getByText("无法读取页面")).toBeInTheDocument();
    expect(screen.getByText("404 not_found")).toBeInTheDocument();
    expect(screen.getByText("Missing page")).toBeInTheDocument();
  });

  it("renders empty state and metric content", () => {
    render(
      <>
        <EmptyState title="暂无认知条目" detail="Try another filter" />
        <MetricCard label="Information" value="31" detail="31 embeddings" />
      </>,
    );
    expect(screen.getByText("暂无认知条目")).toBeInTheDocument();
    expect(screen.getByText("Try another filter")).toBeInTheDocument();
    expect(screen.getByText("Information")).toBeInTheDocument();
    expect(screen.getByText("31 embeddings")).toBeInTheDocument();
  });
});
