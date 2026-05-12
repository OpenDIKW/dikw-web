import type { ArtifactDocument, ArtifactSection } from "./types";

export function exportArtifactMarkdown(artifact: ArtifactDocument): string {
  const lines = [
    `# ${artifact.title}`,
    "",
    `Source: ${artifact.source.label}`,
    `Kind: ${artifact.kind}`,
    `Created: ${artifact.createdAt}`,
    "",
    "## TL;DR",
    artifact.tldr,
    ""
  ];

  if (artifact.metrics.length) {
    lines.push("## Metrics");
    for (const metric of artifact.metrics) {
      lines.push(`- ${metric.label}: ${metric.value}${metric.detail ? ` (${metric.detail})` : ""}`);
    }
    lines.push("");
  }

  for (const section of artifact.sections) {
    lines.push(...sectionToMarkdown(section));
  }

  return lines.join("\n").trimEnd() + "\n";
}

function sectionToMarkdown(section: ArtifactSection): string[] {
  const lines = [`## ${section.title}`];
  if (section.body) {
    lines.push("", section.body);
  }
  if (section.items?.length) {
    lines.push("");
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
  }
  if (section.table) {
    lines.push("", `| ${section.table.columns.join(" | ")} |`);
    lines.push(`| ${section.table.columns.map(() => "-").join(" | ")} |`);
    for (const row of section.table.rows) {
      lines.push(`| ${row.join(" | ")} |`);
    }
  }
  if (section.code) {
    lines.push("", `### ${section.code.label}`, "", "```", section.code.value, "```");
  }
  if (section.details?.length) {
    lines.push("");
    for (const detail of section.details) {
      lines.push(`- ${detail.label}: ${detail.value}`);
    }
  }
  lines.push("");
  return lines;
}
