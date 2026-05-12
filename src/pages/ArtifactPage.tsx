import type { ArtifactDocument, ArtifactSource } from "../artifacts/types";
import { ArtifactShell } from "../components/ArtifactShell";
import { EmptyState } from "../components/EmptyState";

interface ArtifactPageProps {
  artifacts?: ArtifactDocument[];
  selectedId?: string | null;
  onSelectArtifact?: (id: string) => void;
  onOpenSource?: (source: ArtifactSource) => void;
}

export function ArtifactPage({ artifacts = [], selectedId, onSelectArtifact, onOpenSource }: ArtifactPageProps) {
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Artifacts</p>
          <h1>产物工作台</h1>
        </div>
      </header>

      {artifacts.length ? (
        <section className="artifact-page">
          <aside className="panel artifact-gallery" aria-label="Artifact gallery">
            <div className="panel__title">
              Gallery
              <span className="soft-label">{artifacts.length} artifacts</span>
            </div>
            <div className="artifact-gallery__list">
              {artifacts.map((artifact) => (
                <button
                  className={`artifact-card ${selected?.id === artifact.id ? "is-selected" : ""}`}
                  key={artifact.id}
                  type="button"
                  onClick={() => onSelectArtifact?.(artifact.id)}
                >
                  <span>{artifact.kind.replace(/_/g, " ")}</span>
                  <strong>{artifact.title}</strong>
                  <small>{artifact.source.label}</small>
                </button>
              ))}
            </div>
          </aside>

          <main className="artifact-detail">
            {selected ? (
              <>
                {onOpenSource ? (
                  <div className="artifact-detail__toolbar">
                    <button className="secondary-button" type="button" onClick={() => onOpenSource(selected.source)}>
                      打开来源
                    </button>
                  </div>
                ) : null}
                <ArtifactShell artifact={selected} />
              </>
            ) : (
              <section className="panel">
                <EmptyState title="选择一个产物" />
              </section>
            )}
          </main>
        </section>
      ) : (
        <section className="panel">
          <EmptyState title="尚未生成产物" detail="从知识库、任务、查询或图谱页面生成结构化阅读产物。" />
        </section>
      )}
    </div>
  );
}
