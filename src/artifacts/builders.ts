import type { ArtifactDocument, ArtifactMetric, ArtifactSection } from "./types";
import type {
  AppliedWisdomRef,
  Citation,
  DocumentRecord,
  Hit,
  IngestError,
  PageReadResult,
  PageRef,
  TaskEvent,
  TaskRow
} from "../types";
import type { KnowledgeGraph } from "../utils/graph";
import { getMarkdownTitle } from "../utils/markdown";

interface QueryAnswerReportInput {
  question: string;
  answer: string;
  limit: number;
  hits: Hit[];
  citations: Citation[];
  appliedWisdom: AppliedWisdomRef[];
}

interface RetrieveAnswerReportInput {
  question: string;
  limit: number;
  chunks: Hit[];
  pageRefs: PageRef[];
}

export function buildKnowledgeExplainer(page: PageReadResult, doc?: DocumentRecord | null): ArtifactDocument {
  const title = page.title || getMarkdownTitle(page.body) || basename(page.path);
  const headings = extractHeadings(page.body);
  const wikilinks = extractWikilinks(page.body);
  const stats = documentStats(page.body);
  const metrics: ArtifactMetric[] = [
    { label: "Layer", value: page.layer },
    { label: "Anchors", value: String(page.anchors.length) },
    { label: "Headings", value: String(headings.length) },
    { label: "Words", value: String(stats.words) }
  ];
  const sections: ArtifactSection[] = [
    {
      id: "chapters",
      title: "Chapters",
      body: headings.length ? "Detected Markdown heading structure for fast scanning." : "No Markdown headings detected.",
      items: headings.length ? headings.map((heading) => heading.title) : [title]
    },
    {
      id: "wikilinks",
      title: "Wikilinks",
      body: wikilinks.length ? "Internal knowledge references found in this document." : "No wikilinks found in this document.",
      items: wikilinks.length ? wikilinks : ["No wikilinks"]
    },
    {
      id: "document-stats",
      title: "Document stats",
      table: {
        columns: ["Metric", "Value"],
        rows: [
          ["Path", page.path],
          ["Layer", page.layer],
          ["Characters", String(stats.characters)],
          ["Words", String(stats.words)],
          ["Updated", doc?.mtime ? new Date(doc.mtime * 1000).toISOString() : "-"]
        ]
      }
    }
  ];

  return {
    id: `knowledge:${page.path}:${Date.now()}`,
    kind: "knowledge_explainer",
    title: `${title} explainer`,
    source: { label: page.path, view: "wiki", path: page.path },
    createdAt: new Date().toISOString(),
    tldr: `Structured reading artifact generated from ${page.path}. It keeps the Markdown page as the source of truth while surfacing headings, anchors, links, and reading stats.`,
    metrics,
    sections,
    raw: { page, doc }
  };
}

export function buildRunReport(task: TaskRow, events: TaskEvent[]): ArtifactDocument {
  const finalEvent = events.find((event): event is Extract<TaskEvent, { type: "final" }> => event.type === "final");
  const result = finalEvent?.result ?? task.result;
  const fileErrors = collectFileErrors(events, result);
  const progressEvents = events.filter((event): event is Extract<TaskEvent, { type: "progress" }> => event.type === "progress");
  const sections: ArtifactSection[] = [
    {
      id: "timeline",
      title: "Timeline",
      body: "Ordered task event timeline captured from the core task event stream.",
      items: events.map((event) => `#${event.seq} · ${event.type} · ${event.ts}`)
    },
    {
      id: "progress",
      title: "Progress summary",
      table: {
        columns: ["Phase", "Current", "Total"],
        rows: progressEvents.length
          ? progressEvents.map((event) => [event.phase, String(event.current), event.total > 0 ? String(event.total) : "unknown"])
          : [["-", "-", "-"]]
      }
    },
    {
      id: "file-errors",
      title: "File errors",
      body: fileErrors.length ? `${fileErrors.length} ingest file error(s) were reported.` : "No ingest file errors reported.",
      table: {
        columns: ["Path", "Kind", "Message"],
        rows: fileErrors.length ? fileErrors.map((error) => [error.path, error.kind, error.message]) : [["-", "-", "-"]]
      }
    },
    {
      id: "final-result",
      title: "Final result",
      table: {
        columns: ["Field", "Value"],
        rows: primitiveRows(result)
      }
    }
  ];

  return {
    id: `task:${task.task_id}:${Date.now()}`,
    kind: "run_report",
    title: `${task.op} run report`,
    source: { label: task.task_id, view: "tasks", taskId: task.task_id },
    createdAt: new Date().toISOString(),
    tldr: `${task.op} task ${task.task_id} finished with ${task.status}; ${events.length} event(s) were loaded from the task stream.`,
    metrics: [
      { label: "Status", value: task.status },
      { label: "Events", value: String(events.length) },
      { label: "File errors", value: String(fileErrors.length) },
      { label: "Duration", value: task.started_at && task.finished_at ? `${Math.max(0, Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000}s` : "-" }
    ],
    sections,
    raw: { task, events }
  };
}

export function buildQueryAnswerReport(input: QueryAnswerReportInput): ArtifactDocument {
  return {
    id: `query:${slug(input.question)}:${Date.now()}`,
    kind: "answer_report",
    title: `${input.question} answer report`,
    source: { label: input.question, view: "query" },
    createdAt: new Date().toISOString(),
    tldr: `Answer report generated from a Query stream with ${input.citations.length} citation(s), ${input.hits.length} retrieval hit(s), and ${input.appliedWisdom.length} applied wisdom reference(s).`,
    metrics: [
      { label: "Citations", value: String(input.citations.length) },
      { label: "Retrieval hits", value: String(input.hits.length), detail: `limit ${input.limit}` },
      { label: "Applied wisdom", value: String(input.appliedWisdom.length) }
    ],
    sections: [
      {
        id: "answer",
        title: "Answer",
        body: input.answer || "No answer text returned."
      },
      {
        id: "evidence-chain",
        title: "Evidence chain",
        table: {
          columns: ["Path", "Title", "Excerpt"],
          rows: input.citations.length
            ? input.citations.map((citation) => [citation.path, citation.title ?? "-", citation.excerpt])
            : [["-", "-", "-"]]
        }
      },
      {
        id: "retrieval-hits",
        title: "Retrieval hits",
        table: {
          columns: ["Score", "Layer", "Path", "Snippet"],
          rows: input.hits.length
            ? input.hits.map((hit) => [String(hit.score), hit.layer ?? "-", hit.path ?? hit.doc_id, hit.text ?? hit.snippet ?? ""])
            : [["-", "-", "-", "-"]]
        }
      },
      {
        id: "applied-wisdom",
        title: "Applied wisdom",
        table: {
          columns: ["Ref", "Kind", "Title"],
          rows: input.appliedWisdom.length
            ? input.appliedWisdom.map((item) => [item.ref, item.kind, item.title])
            : [["-", "-", "-"]]
        }
      }
    ],
    raw: input
  };
}

export function buildRetrieveAnswerReport(input: RetrieveAnswerReportInput): ArtifactDocument {
  return {
    id: `retrieve:${slug(input.question)}:${Date.now()}`,
    kind: "answer_report",
    title: `${input.question} retrieve report`,
    source: { label: input.question, view: "retrieve" },
    createdAt: new Date().toISOString(),
    tldr: `Retrieve report generated from ${input.chunks.length} chunk(s) and ${input.pageRefs.length} page reference(s).`,
    metrics: [
      { label: "Chunks", value: String(input.chunks.length), detail: `limit ${input.limit}` },
      { label: "Page refs", value: String(input.pageRefs.length) }
    ],
    sections: [
      {
        id: "chunks",
        title: "Chunks",
        table: {
          columns: ["Score", "Layer", "Path", "Excerpt"],
          rows: input.chunks.length
            ? input.chunks.map((chunk) => [String(chunk.score), chunk.layer ?? "-", chunk.path ?? chunk.doc_id, chunk.text ?? chunk.snippet ?? ""])
            : [["-", "-", "-", "-"]]
        }
      },
      {
        id: "page-refs",
        title: "Page refs",
        table: {
          columns: ["Path", "Title", "Chunk IDs", "Score"],
          rows: input.pageRefs.length
            ? input.pageRefs.map((ref) => [ref.path, ref.title ?? "-", ref.hit_chunk_ids.join(", "), String(ref.score)])
            : [["-", "-", "-", "-"]]
        }
      }
    ],
    raw: input
  };
}

export function buildGraphExplainer(graph: KnowledgeGraph, nodeId: string): ArtifactDocument {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId) ?? graph.nodes[0];
  const relatedEdges = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const neighborIds = new Set(relatedEdges.map((edge) => (edge.source === node.id ? edge.target : edge.source)));
  const neighbors = Array.from(neighborIds)
    .map((id) => graph.nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const unresolved = graph.unresolvedLinks.filter((link) => link.source === node.id);

  return {
    id: `graph:${node.id}:${Date.now()}`,
    kind: "graph_explainer",
    title: `${node.title} graph explainer`,
    source: { label: node.path, view: "graph", path: node.path, nodeId: node.id },
    createdAt: new Date().toISOString(),
    tldr: `${node.title} sits in the ${node.layer} graph layer with ${node.inbound} inbound and ${node.outbound} outbound resolved link(s).`,
    metrics: [
      { label: "Inbound", value: String(node.inbound) },
      { label: "Outbound", value: String(node.outbound) },
      { label: "Neighbors", value: String(neighbors.length) },
      { label: "Unresolved", value: String(unresolved.length) }
    ],
    sections: [
      {
        id: "center-node",
        title: "Center node",
        table: {
          columns: ["Field", "Value"],
          rows: [
            ["Title", node.title],
            ["Path", node.path],
            ["Layer", node.layer],
            ["Link count", String(node.linkCount)]
          ]
        }
      },
      {
        id: "neighbors",
        title: "Neighbors",
        body: neighbors.length ? "One-hop resolved neighbors around the focused node." : "No resolved one-hop neighbors.",
        items: neighbors.length ? neighbors.map((neighbor) => neighbor.title) : ["No neighbors"]
      },
      {
        id: "unresolved-links",
        title: "Unresolved links",
        body: unresolved.length ? "Wikilinks emitted by this page that did not resolve to a graph node." : "No unresolved links from this node.",
        items: unresolved.length ? unresolved.map((link) => link.target) : ["No unresolved links"]
      }
    ],
    raw: { node, edges: relatedEdges, unresolved }
  };
}

function extractHeadings(body: string): Array<{ level: number; title: string }> {
  return body
    .split(/\r?\n/)
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ level: match[1].length, title: match[2].trim() }));
}

function extractWikilinks(body: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    links.add(match[1].trim());
  }
  return Array.from(links);
}

function documentStats(body: string): { characters: number; words: number } {
  const plain = body
    .replace(/---[\s\S]*?---/, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/[#`*_>\-[\]()]/g, " ");
  const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;
  return { characters: body.length, words };
}

function collectFileErrors(events: TaskEvent[], result: Record<string, unknown> | null | undefined): IngestError[] {
  const errors = new Map<string, IngestError>();
  const add = (value: unknown) => {
    const error = normalizeIngestError(value);
    if (!error.path && !error.message) {
      return;
    }
    errors.set(`${error.path}\u0000${error.kind}\u0000${error.message}`, error);
  };

  for (const event of events) {
    if (event.type === "partial" && event.kind === "file_error") {
      add(event.payload);
    }
    if (event.type === "final" && event.result && Array.isArray(event.result.errors)) {
      event.result.errors.forEach(add);
    }
  }
  if (result && Array.isArray(result.errors)) {
    result.errors.forEach(add);
  }
  return Array.from(errors.values());
}

function normalizeIngestError(value: unknown): IngestError {
  if (!isRecord(value)) {
    return { path: "-", kind: "parse_error", message: "Unknown file error" };
  }
  const kind = value.kind;
  return {
    path: String(value.path ?? "-"),
    kind: kind === "read_error" || kind === "storage_error" || kind === "parse_error" ? kind : "parse_error",
    message: String(value.message ?? "Unknown file error")
  };
}

function primitiveRows(value: Record<string, unknown> | null | undefined): string[][] {
  if (!value) {
    return [["-", "-"]];
  }
  const rows = Object.entries(value)
    .filter(([, entry]) => typeof entry !== "object" || entry === null)
    .map(([key, entry]) => [key, String(entry ?? "-")]);
  return rows.length ? rows : [["-", "-"]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
