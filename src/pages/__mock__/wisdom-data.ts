// Mock fixtures for the WisdomPage interaction prototype.
// This file is intentionally not wired to any /v1/* endpoint — it exists so
// product/design can iterate on the wisdom read+edit experience before the
// real `POST /v1/base/wisdom` async-task plumbing lands.

export type WisdomMockStatus = "draft" | "published" | "favorite" | "archived";

export interface WisdomMockPage {
  path: string;
  slug: string;
  author?: string;
  title: string;
  body: string;
  status: WisdomMockStatus;
  /** When `status === "favorite"`, remembers what lifecycle state to restore on un-favorite. */
  preStarStatus?: Exclude<WisdomMockStatus, "favorite">;
  tags: string[];
  sources: string[];
  updatedTs: number;
}

export interface WisdomMockCandidate {
  path: string;
  title: string;
  layer: "k" | "w" | "d";
  excerpt: string;
}

export interface WisdomMockBacklink {
  path: string;
  title: string;
}

const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export const wisdomMockPages: WisdomMockPage[] = [
  {
    path: "wisdom/principles/prefer-evidence.md",
    slug: "prefer-evidence",
    author: undefined,
    title: "Prefer evidence",
    status: "published",
    tags: ["principle", "review"],
    sources: ["sources/handbook/dikw-overview.md"],
    updatedTs: t("2026-05-12T09:14:00Z"),
    body: [
      "Anchor every claim to a source the team can re-read.",
      "",
      "When we synthesize, we work down the [[DIKW layered model]]: data leads to",
      "information, information to knowledge, and only then to wisdom. A claim that",
      "skips a layer is a guess — promote it to a wisdom page only after the",
      "underlying knowledge page exists.",
      "",
      "## When to push back",
      "",
      "- Reviewer cannot trace a claim to a K-page or a D-page.",
      "- The supporting K-page is itself unsourced (no [[Provenance edges]]).",
      "- Confidence comes from one author's intuition rather than the [[Retrieval pipeline]].",
      "",
      "Apply the same rule when filling out the Postmortem template — every",
      "timeline entry needs a source the next reader can re-walk."
    ].join("\n")
  },
  {
    path: "wisdom/principles/single-source-of-truth.md",
    slug: "single-source-of-truth",
    author: undefined,
    title: "Single source of truth",
    status: "published",
    tags: ["principle"],
    sources: [],
    updatedTs: t("2026-04-30T12:01:00Z"),
    body: [
      "One canonical home per concept. Aliases link, they do not copy.",
      "",
      "Use the [[Knowledge graph]] to find the canonical page before writing a new",
      "one — drift between two pages on the same topic is worse than a missing page."
    ].join("\n")
  },
  {
    path: "wisdom/team/onboarding.md",
    slug: "onboarding",
    author: "team",
    title: "Team onboarding",
    status: "draft",
    tags: ["team", "onboarding"],
    sources: ["sources/handbook/agent-guidelines.md"],
    updatedTs: t("2026-05-20T17:42:00Z"),
    body: [
      "Day one: read [[DIKW layered model]] and [[Knowledge graph]].",
      "",
      "Day two: run the [[Retrieval pipeline]] locally against the sample sources",
      "and open one PR that adds a wisdom page — even a small one. The point is to",
      "feel the round trip from D → K → W before doing it for real."
    ].join("\n")
  },
  {
    path: "wisdom/team/rituals.md",
    slug: "rituals",
    author: "team",
    title: "Team rituals",
    status: "favorite",
    tags: ["team"],
    sources: [],
    updatedTs: t("2026-05-22T08:00:00Z"),
    body: [
      "Weekly wisdom review: open `#wisdom?status=draft` and triage in pairs.",
      "",
      "We do not approve a draft without at least one [[Provenance edges]]",
      "pointing back to a source page — otherwise we are voting on vibes."
    ].join("\n")
  },
  {
    path: "wisdom/delivery/release-checklist.md",
    slug: "release-checklist",
    author: "delivery",
    title: "Release checklist",
    status: "published",
    tags: ["delivery", "release"],
    sources: ["sources/release/2026-04-release-notes.md"],
    updatedTs: t("2026-05-02T11:00:00Z"),
    body: [
      "Before tagging a release:",
      "",
      "- [[Retrieval pipeline]] passes the smoke set",
      "- [[Embedding strategy]] hash matches the previous release",
      "- No open critical incidents in the [[Postmortem template]] log"
    ].join("\n")
  },
  {
    path: "wisdom/delivery/postmortem-template.md",
    slug: "postmortem-template",
    author: "delivery",
    title: "Postmortem template",
    status: "published",
    tags: ["delivery", "incident"],
    sources: ["sources/postmortems/2026-q1-incident-log.md"],
    updatedTs: t("2026-04-18T15:30:00Z"),
    body: [
      "Frame every postmortem around [[Prefer evidence]] — facts before story.",
      "",
      "Sections:",
      "",
      "1. Timeline (UTC, with sources)",
      "2. What was happening at each [[Storage layers]] tier",
      "3. What the [[Agent loop]] tried and why it failed",
      "4. Wisdom we are willing to promote out of this incident"
    ].join("\n")
  },
  {
    path: "wisdom/architecture.md",
    slug: "architecture",
    author: undefined,
    title: "Architecture decisions",
    status: "archived",
    tags: ["architecture"],
    sources: ["sources/research/llm-retrieval-survey.md"],
    updatedTs: t("2026-02-09T20:18:00Z"),
    body: [
      "Historical notes about the [[Sidecar services]] split.",
      "",
      "Kept for context; superseded by the per-page ADRs under `base/architecture/`."
    ].join("\n")
  }
];

export const wisdomMockKCandidates: WisdomMockCandidate[] = [
  {
    path: "base/concepts/dikw-layered-model.md",
    title: "DIKW layered model",
    layer: "k",
    excerpt: "Data → Information → Knowledge → Wisdom; each layer composes the one above."
  },
  {
    path: "base/concepts/knowledge-graph.md",
    title: "Knowledge graph",
    layer: "k",
    excerpt: "Directed graph over K-pages with wikilink and provenance edges."
  },
  {
    path: "base/concepts/retrieval-pipeline.md",
    title: "Retrieval pipeline",
    layer: "k",
    excerpt: "Embed → ANN search → rerank → snippet expansion."
  },
  {
    path: "base/concepts/provenance.md",
    title: "Provenance edges",
    layer: "k",
    excerpt: "Edges from K/W pages back to the D-layer source they cite."
  },
  {
    path: "base/concepts/agent-loop.md",
    title: "Agent loop",
    layer: "k",
    excerpt: "Plan → call tool → observe → reflect → next step."
  },
  {
    path: "base/architecture/storage-layers.md",
    title: "Storage layers",
    layer: "k",
    excerpt: "On-disk markdown, sqlite index, in-memory ANN."
  },
  {
    path: "base/architecture/embedding-strategy.md",
    title: "Embedding strategy",
    layer: "k",
    excerpt: "Per-chunk vectors, page-level mean, separate index per layer."
  },
  {
    path: "base/architecture/sidecar-services.md",
    title: "Sidecar services",
    layer: "k",
    excerpt: "Same-origin Node middleware: /agent/* and /web/*."
  },
  {
    path: "base/usage/import-pipeline.md",
    title: "Import pipeline",
    layer: "k",
    excerpt: "Bundle markdown + assets → /v1/import → ingest → synth → lint."
  },
  {
    path: "base/usage/wikilinks-syntax.md",
    title: "Wikilinks syntax",
    layer: "k",
    excerpt: "[[Title]], [[Title|alias]], cross-layer by title with disambiguator."
  }
];

export const wisdomMockDCandidates: WisdomMockCandidate[] = [
  {
    path: "sources/handbook/dikw-overview.md",
    title: "DIKW overview handbook",
    layer: "d",
    excerpt: "Internal handbook chapter introducing the four layers."
  },
  {
    path: "sources/handbook/agent-guidelines.md",
    title: "Agent guidelines",
    layer: "d",
    excerpt: "Internal guidelines for working with the agent in chat."
  },
  {
    path: "sources/release/2026-04-release-notes.md",
    title: "April 2026 release notes",
    layer: "d",
    excerpt: "What shipped in 2026.04 and the known issues that did not."
  },
  {
    path: "sources/postmortems/2026-q1-incident-log.md",
    title: "Q1 2026 incident log",
    layer: "d",
    excerpt: "Raw incident notes from January through March 2026."
  },
  {
    path: "sources/research/llm-retrieval-survey.md",
    title: "LLM retrieval survey",
    layer: "d",
    excerpt: "External survey paper on retrieval-augmented generation patterns."
  },
  {
    path: "sources/policy/data-retention.md",
    title: "Data retention policy",
    layer: "d",
    excerpt: "Legal-reviewed retention policy for source and derived documents."
  }
];

// Which wisdom pages link TO each wisdom page (i.e. inbound wikilinks).
// Hand-derived from the bodies above; kept as a static map so the mock
// renders deterministically without re-parsing markdown on every render.
export const wisdomMockBacklinks: Record<string, WisdomMockBacklink[]> = {
  "wisdom/principles/prefer-evidence.md": [
    { path: "wisdom/delivery/postmortem-template.md", title: "Postmortem template" }
  ]
};
