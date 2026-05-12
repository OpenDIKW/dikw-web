export type ArtifactKind = "knowledge_explainer" | "run_report" | "answer_report" | "graph_explainer";

export interface ArtifactSource {
  label: string;
  view: "wiki" | "tasks" | "query" | "retrieve" | "graph";
  path?: string;
  taskId?: string;
  nodeId?: string;
}

export interface ArtifactMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface ArtifactTable {
  columns: string[];
  rows: string[][];
}

export interface ArtifactSection {
  id: string;
  title: string;
  body?: string;
  items?: string[];
  table?: ArtifactTable;
  code?: {
    label: string;
    value: string;
  };
  details?: Array<{
    label: string;
    value: string;
  }>;
}

export interface ArtifactDocument {
  id: string;
  kind: ArtifactKind;
  title: string;
  source: ArtifactSource;
  createdAt: string;
  tldr: string;
  metrics: ArtifactMetric[];
  sections: ArtifactSection[];
  raw: unknown;
}
