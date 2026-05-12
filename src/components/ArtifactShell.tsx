import { Copy } from "lucide-react";
import { useState } from "react";
import { exportArtifactMarkdown } from "../artifacts/export";
import type { ArtifactDocument, ArtifactSection } from "../artifacts/types";

interface ArtifactShellProps {
  artifact: ArtifactDocument;
}

export function ArtifactShell({ artifact }: ArtifactShellProps) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    await navigator.clipboard?.writeText(exportArtifactMarkdown(artifact));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className="artifact-shell">
      <header className="artifact-hero">
        <div>
          <p className="eyebrow">{kindLabel(artifact.kind)}</p>
          <h1>{artifact.title}</h1>
          <div className="artifact-source">
            <span>Source</span>
            <strong>{artifact.source.label}</strong>
          </div>
        </div>
        <button className="secondary-button" type="button" onClick={copyMarkdown}>
          <Copy size={16} aria-hidden="true" />
          {copied ? "Copied" : "Copy as markdown"}
        </button>
      </header>

      <section className="artifact-tldr">
        <div className="artifact-section-label">TL;DR</div>
        <p>{artifact.tldr}</p>
      </section>

      {artifact.metrics.length ? (
        <section className="artifact-metrics" aria-label="Artifact metrics">
          {artifact.metrics.map((metric) => (
            <div className="artifact-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail ? <small>{metric.detail}</small> : null}
            </div>
          ))}
        </section>
      ) : null}

      {artifact.sections.length ? (
        <nav className="artifact-toc" aria-label="Artifact table of contents">
          {artifact.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="artifact-sections">
        {artifact.sections.map((section) => (
          <ArtifactSectionView section={section} key={section.id} />
        ))}
      </div>

      <details className="artifact-raw">
        <summary>Raw data</summary>
        <pre>{JSON.stringify(artifact.raw, null, 2)}</pre>
      </details>
    </article>
  );
}

function ArtifactSectionView({ section }: { section: ArtifactSection }) {
  return (
    <section className="artifact-section" id={section.id}>
      <h2>{section.title}</h2>
      {section.body ? <p>{section.body}</p> : null}
      {section.items?.length ? (
        <ul>
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {section.table ? (
        <div className="markdown-table-wrap">
          <table>
            <thead>
              <tr>
                {section.table.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, rowIndex) => (
                <tr key={`${section.id}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${section.id}-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {section.code ? (
        <div className="code-block">
          <div className="code-label">{section.code.label}</div>
          <pre>
            <code>{section.code.value}</code>
          </pre>
        </div>
      ) : null}
      {section.details?.length ? (
        <div className="artifact-detail-list">
          {section.details.map((detail) => (
            <div key={detail.label}>
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function kindLabel(kind: ArtifactDocument["kind"]): string {
  if (kind === "knowledge_explainer") {
    return "Knowledge Explainer";
  }
  if (kind === "run_report") {
    return "Run Report";
  }
  if (kind === "answer_report") {
    return "Answer Report";
  }
  return "Graph Explainer";
}
