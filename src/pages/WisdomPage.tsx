import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Search,
  Star,
  X
} from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import { basename, formatUnixSeconds, truncateMiddle } from "../utils/format";
import { injectInlineRefs } from "../utils/source-inline-refs";
import {
  clearWisdomWriteState,
  loadWisdomWriteState,
  saveWisdomWriteState
} from "../state/wisdom-write";

interface WisdomPageProps {
  client: DikwClient;
  locale?: Locale;
}

// dikw-core wire shapes (lowercase StrEnum)
type Layer = "source" | "knowledge" | "wisdom";
type WisdomStatus = "draft" | "published" | "favorite" | "archived";

interface DocumentRecord {
  doc_id: string;
  path: string;
  title: string | null;
  hash?: string;
  mtime: number;
  layer: Layer;
  active: boolean;
  status?: WisdomStatus | null;
}

interface PageAsset {
  asset_id: string;
  kind: string;
  mime: string;
  bytes: number;
  url: string;
  original_paths?: string[];
}

interface PageReadResult {
  doc_id: string;
  path: string;
  layer: Layer;
  title: string | null;
  body: string;
  anchors?: unknown[];
  assets?: PageAsset[];
  frontmatter?: Record<string, unknown>;
}

interface PageLinkIncoming {
  src_doc_id: string;
  src_path: string;
  link_type: "wikilink" | "markdown" | "url";
  anchor?: string | null;
  line?: number;
}

interface PageLinksResult {
  path: string;
  outgoing?: unknown[];
  incoming?: PageLinkIncoming[];
}

interface TaskHandle {
  task_id: string;
  op: string;
  status: string;
  created_at: string;
}

interface WisdomWriteReport {
  path: string;
  created: boolean;
  hash: string;
  chunks: number;
  embedded: number;
  unresolved_wikilinks: number;
}

interface WisdomWriteSubmit {
  slug: string;
  title: string;
  body: string;
  author?: string;
  status?: WisdomStatus;
  tags?: string[];
  sources?: string[];
  extras?: Record<string, unknown>;
  no_embed?: boolean;
}

// Local page model — fields mirror the old mock shape so helper functions
// (buildWisdomTree, pageIsDirty, ...) stay unchanged. ``body`` is empty
// until the detail fetch hydrates it; ``isPending`` marks an unsaved
// client-only row created via the New dialog (it shows in the tree but is
// not in core yet — the first Save POSTs it).
interface WisdomPage {
  path: string;
  slug: string;
  author?: string;
  title: string;
  body: string;
  status: WisdomStatus;
  tags: string[];
  sources: string[];
  updatedTs: number;
  isPending?: boolean;
  /** True once the per-page detail fetch (or local create) has populated
   *  the body/sources/frontmatter. List endpoint rows arrive with body=""
   *  before the detail GET resolves — we MUST NOT let the user open Edit
   *  on a placeholder, because Save would overwrite the real core body
   *  with whatever the user typed on top of nothing. */
  bodyLoaded?: boolean;
  /** Custom frontmatter keys (anything outside title/status/tags/sources)
   *  pulled from the detail fetch so a Save / favorite toggle can echo
   *  them back via WisdomWriteSubmit.extras. Without this, core's full-
   *  rewrite of the file would silently drop the user's custom YAML keys
   *  (aliases, review notes, etc.). */
  extras: Record<string, unknown>;
}

interface WisdomCandidate {
  path: string;
  title: string;
  layer: "k" | "w" | "d";
  excerpt: string;
}

interface WisdomTreeNode {
  id: string;
  name: string;
  children: WisdomTreeNode[];
  page: WisdomPage | null;
}

interface NewDialogState {
  slug: string;
  author: string;
  title: string;
  error: string | null;
}

type RefMode = "wikilink" | "source";

type UnsavedTarget =
  | { kind: "switch"; path: string }
  | { kind: "read" }
  | { kind: "create"; page: WisdomPage }
  | { kind: "collapseDir"; dirId: string };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PENDING_PATH_PREFIX = "__pending__/";

export function WisdomPage({ client, locale = "en" }: WisdomPageProps) {
  const copy = translations[locale].pages.wisdom;

  // ── data sources ────────────────────────────────────────────────────────

  const loadWisdomList = useCallback(
    (signal: AbortSignal) =>
      client.get<DocumentRecord[]>("/v1/base/pages", {
        signal,
        params: { layer: "wisdom", active: true }
      }),
    [client]
  );
  const wisdomList = useAsyncResource<DocumentRecord[]>(loadWisdomList, []);

  // ``pages`` is the union of the list endpoint result (after recordToPage
  // hydration with bodies/sources from per-page detail fetches) and any
  // client-only pending drafts. We keep our own state map keyed by path so
  // edits + detail loads don't fight with the list reload.
  const [pages, setPages] = useState<WisdomPage[]>([]);
  // Optimistic status overrides for in-flight favorite toggles — keeps the
  // UI snappy while the write task completes.
  const [optimisticStatus, setOptimisticStatus] = useState<Map<string, WisdomStatus>>(new Map());
  // Pre-star status side-table, mirroring the previous behavior. Lives only
  // in the React tree (not persisted) — refresh = lose it.
  const preStarStatusRef = useRef<Map<string, WisdomStatus>>(new Map());

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(["wisdom"]));
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState<{ body: string; sources: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);
  const [newDialog, setNewDialog] = useState<NewDialogState | null>(null);
  const [refPopover, setRefPopover] = useState<{ mode: RefMode; query: string } | null>(null);
  const [unsavedTarget, setUnsavedTarget] = useState<UnsavedTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writeAbortRef = useRef<AbortController | null>(null);

  // ── derive list of pages from the API ───────────────────────────────────

  // Whenever the list endpoint updates, merge its rows into ``pages`` while
  // preserving everything we've already hydrated via the detail fetch
  // (body, sources, tags, frontmatter extras, custom status). If we
  // overwrote those with list defaults, the next Save / favorite POST
  // would echo ``extras: {}`` / ``tags: []`` back and core's full-file
  // rewrite would silently drop the user's custom frontmatter and tags.
  useEffect(() => {
    if (!wisdomList.data) return;
    setPages((prev) => {
      const prevByPath = new Map(prev.map((p) => [p.path, p]));
      const next: WisdomPage[] = [];
      for (const row of wisdomList.data!) {
        if (row.layer !== "wisdom") continue;
        const existing = prevByPath.get(row.path);
        const base = recordToPage(row);
        if (existing?.bodyLoaded) {
          // Keep the hydrated copy verbatim; only refresh mtime / hash
          // from the new list row.
          next.push({
            ...existing,
            updatedTs: base.updatedTs
          });
        } else {
          next.push(base);
        }
      }
      // Keep any pending drafts that haven't been saved yet.
      for (const p of prev) {
        if (p.isPending) next.push(p);
      }
      return next;
    });
  }, [wisdomList.data]);

  // Default-select the first wisdom page once the list arrives.
  useEffect(() => {
    if (selectedPath || !pages.length) return;
    setSelectedPath(pages[0].path);
  }, [pages, selectedPath]);

  // ── per-page detail fetch ───────────────────────────────────────────────

  const detailGenerationRef = useRef(0);
  useEffect(() => {
    if (!selectedPath || selectedPath.startsWith(PENDING_PATH_PREFIX)) return;
    const page = pages.find((p) => p.path === selectedPath);
    // Skip the fetch only if the body is already hydrated. A list row
    // arrives with body="" + bodyLoaded=false; treating that as "have body"
    // would let Edit open on a placeholder and Save would clobber the
    // real core body with the user's partial text on save.
    if (page && page.bodyLoaded) return;
    detailGenerationRef.current += 1;
    const generation = detailGenerationRef.current;
    const controller = new AbortController();
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(selectedPath)}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || detailGenerationRef.current !== generation) return;
        setPages((prev) =>
          prev.map((p) =>
            p.path === selectedPath
              ? {
                  ...p,
                  body: result.body,
                  bodyLoaded: true,
                  sources: extractSourcesFromFrontmatter(result.frontmatter) ?? p.sources,
                  tags: extractTagsFromFrontmatter(result.frontmatter) ?? p.tags,
                  title: result.title ?? p.title,
                  status: extractStatusFromFrontmatter(result.frontmatter) ?? p.status,
                  extras: extractExtrasFromFrontmatter(result.frontmatter)
                }
              : p
          )
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DikwClientError && err.code === "task_cancelled") return;
        setToast(copy.detailError);
      });
    return () => controller.abort();
  }, [client, selectedPath, pages, copy.detailError]);

  // ── backlinks fetch ─────────────────────────────────────────────────────

  const [backlinks, setBacklinks] = useState<Array<{ path: string; title: string }>>([]);
  const backlinksGenRef = useRef(0);
  useEffect(() => {
    if (!selectedPath || selectedPath.startsWith(PENDING_PATH_PREFIX)) {
      setBacklinks([]);
      return;
    }
    backlinksGenRef.current += 1;
    const generation = backlinksGenRef.current;
    const controller = new AbortController();
    client
      .get<PageLinksResult>(`/v1/base/pages/${encodePath(selectedPath)}/links`, {
        signal: controller.signal,
        params: { direction: "in" }
      })
      .then((result) => {
        if (controller.signal.aborted || backlinksGenRef.current !== generation) return;
        const incoming = result.incoming ?? [];
        // Filter to wisdom-layer references only. K/D incoming links can't
        // be opened by handleSelectPage (it routes to selectedPath which
        // only resolves against the wisdom list) — clicking one would clear
        // the reader to the empty state. Cross-layer backlink browsing is
        // a separate feature for another iteration.
        const titleByPath = new Map(pages.map((p) => [p.path, p.title]));
        const seen = new Set<string>();
        const refs: Array<{ path: string; title: string }> = [];
        for (const link of incoming) {
          if (!link.src_path.startsWith("wisdom/")) continue;
          if (seen.has(link.src_path)) continue;
          seen.add(link.src_path);
          refs.push({ path: link.src_path, title: titleByPath.get(link.src_path) ?? basename(link.src_path) });
        }
        setBacklinks(refs);
      })
      .catch(() => {
        // 404 / 405 silent degrade — same approach as WikiPage backlinks.
        if (!controller.signal.aborted) setBacklinks([]);
      });
    return () => controller.abort();
  }, [client, selectedPath, pages]);

  // ── candidates for ReferencePopover ─────────────────────────────────────

  // Lazy-load K/D candidate lists when the popover opens. We don't fetch on
  // mount because most users may never open the picker on a given session.
  const [kCandidates, setKCandidates] = useState<WisdomCandidate[] | null>(null);
  const [dCandidates, setDCandidates] = useState<WisdomCandidate[] | null>(null);
  useEffect(() => {
    if (!refPopover) return;
    const need = refPopover.mode === "wikilink" ? "knowledge" : "source";
    if (need === "knowledge" && kCandidates) return;
    if (need === "source" && dCandidates) return;
    const controller = new AbortController();
    client
      .get<DocumentRecord[]>("/v1/base/pages", {
        signal: controller.signal,
        params: { layer: need, active: true }
      })
      .then((rows) => {
        if (controller.signal.aborted) return;
        const layer: WisdomCandidate["layer"] = need === "knowledge" ? "k" : "d";
        const mapped = rows.map<WisdomCandidate>((row) => ({
          path: row.path,
          title: row.title ?? basename(row.path),
          layer,
          excerpt: ""
        }));
        if (need === "knowledge") setKCandidates(mapped);
        else setDCandidates(mapped);
      })
      .catch(() => {
        // If candidates fail to load we fall back to a wisdom-only popover —
        // not catastrophic, the user can still pick W targets.
        if (controller.signal.aborted) return;
        if (need === "knowledge") setKCandidates([]);
        else setDCandidates([]);
      });
    return () => controller.abort();
  }, [client, refPopover, kCandidates, dCandidates]);

  // ── resume in-flight write on mount ─────────────────────────────────────

  useEffect(() => {
    const stored = loadWisdomWriteState(client.coreId);
    if (!stored) return;
    // Re-attach to the running task. We don't know which row to bind to
    // until the list arrives, so just enter the saving state and let the
    // poll loop reload the list when terminal.
    setSaving(true);
    setSavingMessage(copy.resumingSave);
    const controller = new AbortController();
    writeAbortRef.current = controller;
    void pollWriteTask({
      client,
      taskId: stored.taskId,
      signal: controller.signal,
      onTerminal: (report) => {
        finalizeWrite(report, stored.targetPath);
      },
      onError: (err) => {
        handleWriteFailure(err);
      }
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── memoized derived state ──────────────────────────────────────────────

  const displayedPages = useMemo<WisdomPage[]>(() => {
    if (!optimisticStatus.size) return pages;
    return pages.map((p) =>
      optimisticStatus.has(p.path) ? { ...p, status: optimisticStatus.get(p.path)! } : p
    );
  }, [pages, optimisticStatus]);

  const visiblePages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let next = displayedPages;
    if (starredOnly) next = next.filter((p) => p.status === "favorite");
    if (!needle) return next;
    return next.filter((p) => `${p.path} ${p.title}`.toLowerCase().includes(needle));
  }, [filter, displayedPages, starredOnly]);

  const tree = useMemo(() => buildWisdomTree(visiblePages), [visiblePages]);

  const expandedTreeIds = useMemo(() => {
    const next = new Set(expandedDirs);
    if (filter.trim()) {
      collectDirectoryIds(tree, next);
    }
    if (selectedPath) {
      collectPathAncestors(selectedPath).forEach((id) => next.add(id));
    }
    return next;
  }, [expandedDirs, filter, selectedPath, tree]);

  const selected = useMemo(
    () => displayedPages.find((p) => p.path === selectedPath) ?? null,
    [displayedPages, selectedPath]
  );

  // Run the same inline-ref injection as the Source layer reader: backlink
  // titles that appear literally in the wisdom body become `[[title|literal]]`.
  // Only un-inlined refs land in the bottom aside.
  const enhancedReadBody = useMemo(() => {
    if (!selected) return { body: "", matchedPaths: new Set<string>() };
    return injectInlineRefs(selected.body, backlinks);
  }, [selected, backlinks]);

  const unmatchedBacklinks = useMemo(() => {
    if (!selected) return [];
    return backlinks.filter((b) => !enhancedReadBody.matchedPaths.has(b.path));
  }, [selected, backlinks, enhancedReadBody.matchedPaths]);

  const isDirty = mode === "edit" && draft !== null && selected !== null && pageIsDirty(selected, draft);

  const wisdomCandidatesForPopover = useMemo<WisdomCandidate[]>(
    () =>
      displayedPages
        .filter((p) => !p.isPending && p.path !== selectedPath)
        .map<WisdomCandidate>((p) => ({
          path: p.path,
          title: p.title,
          layer: "w",
          excerpt: firstBodyLine(p.body)
        })),
    [displayedPages, selectedPath]
  );

  // ── navigation guards ──────────────────────────────────────────────────

  const requestNavigate = (target: UnsavedTarget) => {
    if (mode === "edit" && isDirty) {
      setUnsavedTarget(target);
      return;
    }
    applyNavigate(target);
  };

  const applyCreate = (page: WisdomPage) => {
    setPages((prev) => [...prev, page]);
    setNewDialog(null);
    setSelectedPath(page.path);
    setDraft({ body: "", sources: [...page.sources] });
    setMode("edit");
    // Pending drafts live under the synthetic ``wisdom/(pending)`` tree
    // branch but selectedPath is ``__pending__/{slug}``, so
    // collectPathAncestors below never expands the pending folder. Make
    // sure the row the user just created is visible by force-expanding it
    // here.
    if (page.isPending) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add("wisdom/(pending)");
        return next;
      });
    }
  };

  const applyNavigate = (target: UnsavedTarget) => {
    setRefPopover(null);
    if (target.kind === "switch") {
      setSelectedPath(target.path);
      setMode("read");
      setDraft(null);
    } else if (target.kind === "read") {
      setMode("read");
      setDraft(null);
    } else if (target.kind === "collapseDir") {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(target.dirId);
        return next;
      });
      setSelectedPath(null);
      setMode("read");
      setDraft(null);
    } else {
      applyCreate(target.page);
    }
  };

  const handleSelectPage = (path: string) => {
    if (path === selectedPath && mode === "read") return;
    requestNavigate({ kind: "switch", path });
  };

  const toggleDir = (id: string) => {
    const isClosing = expandedTreeIds.has(id);
    // Collapsing a directory that contains the currently selected page must
    // also clear the selection — otherwise collectPathAncestors below would
    // immediately re-expand it. That clears the draft, so route through
    // requestNavigate to prompt before discarding unsaved edits.
    if (isClosing && selectedPath && pathIsInsideDirectory(selectedPath, id)) {
      requestNavigate({ kind: "collapseDir", dirId: id });
      return;
    }
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterEditMode = () => {
    if (!selected) return;
    // Block Edit until the body has actually been pulled from core.
    // Otherwise the textarea opens on a "" placeholder and the eventual
    // Save would overwrite the real body with whatever the user typed.
    if (!selected.bodyLoaded) {
      setToast(copy.editLoadingHint);
      return;
    }
    setDraft({ body: selected.body, sources: [...selected.sources] });
    setMode("edit");
  };

  const enterReadMode = () => {
    if (mode === "read") return;
    requestNavigate({ kind: "read" });
  };

  // ── save / favorite — the real API path ────────────────────────────────

  function finalizeWrite(report: WisdomWriteReport, prevPath: string) {
    clearWisdomWriteState();
    writeAbortRef.current = null;
    setSaving(false);
    setSavingMessage(null);
    setDraft(null);
    setMode("read");
    // Replace the pending row (if any) with the real path returned from core.
    setPages((prev) => {
      const filtered = prev.filter((p) => p.path !== prevPath && p.path !== report.path);
      // Drop our local snapshot for the saved path — let the list reload
      // populate the canonical row. Detail fetch will refill body/sources.
      return filtered;
    });
    setSelectedPath(report.path);
    setOptimisticStatus((prev) => {
      const next = new Map(prev);
      next.delete(prevPath);
      next.delete(report.path);
      return next;
    });
    wisdomList.reload();
    if (report.unresolved_wikilinks > 0) {
      setToast(copy.savedWithUnresolved.replace("{n}", String(report.unresolved_wikilinks)));
    } else {
      setToast(copy.saved);
    }
  }

  function handleWriteFailure(err: unknown) {
    clearWisdomWriteState();
    writeAbortRef.current = null;
    setSaving(false);
    setSavingMessage(null);
    setOptimisticStatus(new Map());
    if (err instanceof DikwClientError && err.code === "task_cancelled") {
      setToast(copy.saveCancelled);
      return;
    }
    setToast(copy.saveFailed);
  }

  const handleSave = () => {
    if (!selected || !draft || saving) return;
    if (!draft.body.trim()) {
      setToast(copy.bodyRequired);
      return;
    }
    const submit: WisdomWriteSubmit = {
      slug: selected.slug,
      title: selected.title,
      body: draft.body,
      author: selected.author,
      status: selected.status,
      tags: selected.tags,
      sources: draft.sources,
      // Preserve any custom frontmatter keys the page already had —
      // otherwise core's full-file rewrite would drop them. Empty for
      // pending drafts and for pages with no extras.
      ...(Object.keys(selected.extras).length ? { extras: selected.extras } : {})
    };
    setSaving(true);
    setSavingMessage(copy.savingMessage);
    setRefPopover(null);
    const controller = new AbortController();
    writeAbortRef.current = controller;
    const prevPath = selected.path;
    const scope: "edit" | "create" = selected.isPending ? "create" : "edit";
    client
      .post<TaskHandle>("/v1/base/wisdom", submit, { signal: controller.signal })
      .then((handle) => {
        saveWisdomWriteState(
          { taskId: handle.task_id, targetPath: prevPath, slug: selected.slug, scope },
          client.coreId
        );
        return pollWriteTask({
          client,
          taskId: handle.task_id,
          signal: controller.signal,
          onTerminal: (report) => finalizeWrite(report, prevPath),
          onError: (err) => handleWriteFailure(err)
        });
      })
      .catch((err: unknown) => handleWriteFailure(err));
  };

  const toggleFavorite = (path: string) => {
    if (saving) return;
    // Star is a side-channel write that POSTs the *current* body/sources, so
    // an unsaved draft would either be silently lost (finalizeWrite clears
    // the draft) or overwritten with the pre-edit body. Block the toggle
    // until the user resolves their dirty edit first.
    if (mode === "edit" && isDirty) {
      setToast(copy.favoriteDirtyHint);
      return;
    }
    const target = pages.find((p) => p.path === path);
    if (!target || target.isPending) {
      if (target?.isPending) setToast(copy.favoritePendingHint);
      return;
    }
    // Body must be hydrated — favorite POSTs the full page (no metadata-only
    // endpoint yet) so an empty body would land as `min_length=1` 422 OR
    // overwrite the real core body with an empty string depending on
    // validation order. Surface a hint so the user knows their click
    // didn't no-op silently.
    if (!target.bodyLoaded) {
      setToast(copy.editLoadingHint);
      return;
    }
    const wasFavorite = target.status === "favorite";
    // Snapshot the previous pre-star value before we mutate the ref so that
    // a failed un-favorite can restore exactly the same lifecycle on rollback
    // (without it, the rollback would write target.status="favorite" back
    // into the ref and the next retry would still compute nextStatus as
    // "favorite", leaving the row stuck).
    const previousPreStarValue = preStarStatusRef.current.get(path);
    const nextStatus: WisdomStatus = wasFavorite
      ? previousPreStarValue ?? "published"
      : "favorite";
    if (!wasFavorite) {
      preStarStatusRef.current.set(path, target.status);
    } else {
      preStarStatusRef.current.delete(path);
    }
    setOptimisticStatus((prev) => {
      const next = new Map(prev);
      next.set(path, nextStatus);
      return next;
    });
    const rollback = () => {
      setOptimisticStatus((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      if (wasFavorite) {
        // Restore the previous pre-star value (if any). Don't write
        // target.status="favorite" back — that would loop the next retry.
        if (previousPreStarValue !== undefined) {
          preStarStatusRef.current.set(path, previousPreStarValue);
        } else {
          preStarStatusRef.current.delete(path);
        }
      } else {
        preStarStatusRef.current.delete(path);
      }
    };
    const submit: WisdomWriteSubmit = {
      slug: target.slug,
      title: target.title,
      body: target.body,
      author: target.author,
      status: nextStatus,
      tags: target.tags,
      sources: target.sources,
      ...(Object.keys(target.extras).length ? { extras: target.extras } : {}),
      // no_embed=true is the documented trade-off for ☆ toggles — core
      // doesn't expose a metadata-only patch endpoint yet, so we skip
      // the (slow + costly) embedding step. The downside: the page falls
      // out of vector retrieval until the next ingest re-embeds it. See
      // CHANGELOG 0.0.12 for the deferred mitigation.
      no_embed: true
    };
    setSaving(true);
    setSavingMessage(copy.savingStatusMessage);
    const controller = new AbortController();
    writeAbortRef.current = controller;
    client
      .post<TaskHandle>("/v1/base/wisdom", submit, { signal: controller.signal })
      .then((handle) => {
        saveWisdomWriteState(
          { taskId: handle.task_id, targetPath: path, slug: target.slug, scope: "favorite" },
          client.coreId
        );
        return pollWriteTask({
          client,
          taskId: handle.task_id,
          signal: controller.signal,
          onTerminal: (report) => finalizeWrite(report, path),
          onError: (err) => {
            rollback();
            handleWriteFailure(err);
          }
        });
      })
      .catch((err: unknown) => {
        rollback();
        handleWriteFailure(err);
      });
  };

  const handleConfirmDiscard = () => {
    if (!unsavedTarget) return;
    const target = unsavedTarget;
    setUnsavedTarget(null);
    applyNavigate(target);
  };

  const handleCancelDiscard = () => setUnsavedTarget(null);

  const openNewDialog = () => setNewDialog({ slug: "", author: "", title: "", error: null });
  const closeNewDialog = () => setNewDialog(null);

  const handleCreate = () => {
    if (!newDialog) return;
    // Block creation while the wisdom list is still loading or failed to
    // load. Without it, the dup-check below sees an empty list and would
    // accept a slug that already exists on the server — the eventual Save
    // POST upserts via /v1/base/wisdom and would silently overwrite that
    // page.
    if (wisdomList.loading || wisdomList.error || !wisdomList.data) {
      setNewDialog({ ...newDialog, error: copy.newError.listLoading });
      return;
    }
    const slug = newDialog.slug.trim();
    const author = newDialog.author.trim() || undefined;
    const title = newDialog.title.trim();
    if (!title) {
      setNewDialog({ ...newDialog, error: copy.newError.title });
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setNewDialog({ ...newDialog, error: copy.newError.slug });
      return;
    }
    if (author && !SLUG_RE.test(author)) {
      setNewDialog({ ...newDialog, error: copy.newError.author });
      return;
    }
    // Pending drafts live under a private path namespace so they don't
    // collide with any real wisdom path while they're unsaved.
    const pendingPath = `${PENDING_PATH_PREFIX}${author ? `${author}/${slug}` : slug}`;
    const realPath = author ? `wisdom/${author}/${slug}.md` : `wisdom/${slug}.md`;
    const realPathLower = realPath.toLowerCase();
    if (pages.some((p) => !p.isPending && p.path.toLowerCase() === realPathLower)) {
      setNewDialog({ ...newDialog, error: copy.newError.duplicate });
      return;
    }
    if (pages.some((p) => p.isPending && p.path === pendingPath)) {
      setNewDialog({ ...newDialog, error: copy.newError.duplicate });
      return;
    }
    const created: WisdomPage = {
      path: pendingPath,
      slug,
      author,
      title,
      body: "",
      status: "draft",
      tags: [],
      sources: [],
      updatedTs: Math.floor(Date.now() / 1000),
      isPending: true,
      // A pending draft is a client-local create — there is no server body
      // to hydrate, so editing is immediately safe.
      bodyLoaded: true,
      extras: {}
    };
    if (mode === "edit" && isDirty) {
      setUnsavedTarget({ kind: "create", page: created });
      return;
    }
    applyCreate(created);
  };

  const insertWikilink = (title: string) => {
    if (!draft || saving) return;
    const el = textareaRef.current;
    const inserted = `[[${title}]]`;
    if (!el) {
      setDraft({ ...draft, body: `${draft.body}${draft.body && !draft.body.endsWith("\n") ? "\n" : ""}${inserted}` });
      setRefPopover(null);
      return;
    }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const nextBody = `${draft.body.slice(0, start)}${inserted}${draft.body.slice(end)}`;
    setDraft({ ...draft, body: nextBody });
    setRefPopover(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const caret = start + inserted.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(caret, caret);
    });
  };

  const addSource = (path: string) => {
    if (!draft || saving) return;
    if (draft.sources.includes(path)) {
      setRefPopover(null);
      return;
    }
    setDraft({ ...draft, sources: [...draft.sources, path] });
    setRefPopover(null);
  };

  const removeSource = (path: string) => {
    if (!draft) return;
    setDraft({ ...draft, sources: draft.sources.filter((s) => s !== path) });
  };

  const handleWikiLinkClick = (target: string) => {
    const lower = target.trim().toLowerCase();
    const match = pages.find((p) => p.title.toLowerCase() === lower);
    if (match) {
      handleSelectPage(match.path);
      return;
    }
    setToast(copy.unresolvedWikilink.replace("{title}", target));
  };

  // Single Escape handler for all stacked dialogs (priority: unsaved >
  // newDialog > refPopover).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (unsavedTarget) setUnsavedTarget(null);
      else if (newDialog) setNewDialog(null);
      else if (refPopover) setRefPopover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [refPopover, newDialog, unsavedTarget]);

  // Abort any in-flight write controller on unmount so a deferred onTerminal
  // doesn't fire setState on a torn-down tree.
  useEffect(() => {
    return () => {
      if (writeAbortRef.current) {
        writeAbortRef.current.abort();
        writeAbortRef.current = null;
      }
    };
  }, []);

  // Close the reference popover if a save kicks off while it's open.
  useEffect(() => {
    if (saving) setRefPopover(null);
  }, [saving]);

  // Auto-dismiss the transient toast after a short delay.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.description}</p>
        </div>
        <button className="primary-button" type="button" onClick={openNewDialog}>
          <Plus size={16} aria-hidden="true" />
          <span>{copy.newButton}</span>
        </button>
      </header>

      <section className="wiki-layout wisdom-layout">
        <aside className="wiki-sidebar">
          <div className="wiki-explorer__header">
            <h2>{copy.directoryTitle}</h2>
            <span className="soft-label">{formatCount(visiblePages.length, copy.fileCount)}</span>
          </div>
          <button
            type="button"
            className={`wisdom-starred-chip ${starredOnly ? "is-on" : ""}`}
            onClick={() => setStarredOnly((prev) => !prev)}
            aria-pressed={starredOnly}
          >
            <Star size={13} aria-hidden="true" fill={starredOnly ? "currentColor" : "none"} />
            <span>{copy.starredOnly}</span>
          </button>
          <label className="wiki-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label={copy.searchLabel}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
            {filter ? (
              <button
                className="wiki-search__clear"
                type="button"
                onClick={() => setFilter("")}
                aria-label={copy.clearSearch}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          {wisdomList.loading && !pages.length ? (
            <EmptyState title={copy.loadingList} />
          ) : wisdomList.error && !pages.length ? (
            <EmptyState title={copy.listError} />
          ) : visiblePages.length ? (
            <WisdomTree
              nodes={tree}
              selectedPath={selectedPath}
              expandedIds={expandedTreeIds}
              onToggle={toggleDir}
              onSelect={handleSelectPage}
            />
          ) : (
            <EmptyState title={copy.noMatches} />
          )}
        </aside>

        <main className="wiki-reader panel wisdom-reader" aria-label={copy.readerRegion}>
          {toast ? (
            <div className="wisdom-toast" role="status" aria-live="polite">
              {toast}
            </div>
          ) : null}
          {selected ? (
            <>
              <div className="reader-header reader-header--stacked">
                <div className="reader-header__path">{selected.isPending ? copy.pendingPathHint : selected.path}</div>
                <div className="reader-header__meta reader-header__meta--inline">
                  <span className="soft-label">{formatUnixSeconds(selected.updatedTs)}</span>
                  <button
                    type="button"
                    className={`wisdom-star ${selected.status === "favorite" ? "is-on" : ""}`}
                    onClick={() => toggleFavorite(selected.path)}
                    aria-pressed={selected.status === "favorite"}
                    aria-label={selected.status === "favorite" ? copy.unfavorite : copy.favorite}
                    title={selected.status === "favorite" ? copy.unfavorite : copy.favorite}
                    disabled={saving || selected.isPending || (mode === "edit" && isDirty)}
                  >
                    <Star
                      size={16}
                      aria-hidden="true"
                      fill={selected.status === "favorite" ? "currentColor" : "none"}
                    />
                  </button>
                  <WisdomStatusChip status={selected.status} locale={locale} />
                </div>
              </div>
              <div className="wiki-reader-tabs" role="tablist" aria-label={copy.tabList}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "read"}
                  className={mode === "read" ? "is-active" : ""}
                  onClick={enterReadMode}
                >
                  {copy.readTab}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "edit"}
                  className={mode === "edit" ? "is-active" : ""}
                  onClick={() => (mode === "edit" ? undefined : enterEditMode())}
                >
                  {copy.editTab}
                </button>
              </div>

              {mode === "read" ? (
                <section className="wiki-reader-tab-panel" role="tabpanel" aria-label={copy.readTab}>
                  <MarkdownView
                    body={enhancedReadBody.body || selected.body}
                    fallbackTitle={selected.title}
                    onWikiLink={handleWikiLinkClick}
                    showFrontmatter={false}
                  />
                  <WisdomReadAside
                    backlinks={unmatchedBacklinks}
                    sources={selected.sources}
                    onOpen={(path) => handleSelectPage(path)}
                    copy={copy}
                  />
                </section>
              ) : (
                <WisdomEditor
                  draft={draft ?? { body: selected.body, sources: [...selected.sources] }}
                  saving={saving}
                  savingMessage={savingMessage}
                  textareaRef={textareaRef}
                  onChangeBody={(body) =>
                    setDraft((d) => (d ? { ...d, body } : { body, sources: [...selected.sources] }))
                  }
                  onRemoveSource={removeSource}
                  onOpenRefPopover={() => setRefPopover({ mode: "wikilink", query: "" })}
                  onOpenSourcesPopover={() => setRefPopover({ mode: "source", query: "" })}
                  onSave={handleSave}
                  copy={copy}
                />
              )}
            </>
          ) : (
            <EmptyState title={copy.emptyReader} />
          )}
        </main>
      </section>

      {refPopover ? (
        <ReferencePopover
          mode={refPopover.mode}
          query={refPopover.query}
          wisdomCandidates={wisdomCandidatesForPopover}
          kCandidates={kCandidates ?? []}
          dCandidates={dCandidates ?? []}
          candidatesLoading={refPopover.mode === "wikilink" ? !kCandidates : !dCandidates}
          onQueryChange={(query) => setRefPopover({ ...refPopover, query })}
          onPick={(value) => (refPopover.mode === "wikilink" ? insertWikilink(value) : addSource(value))}
          onClose={() => setRefPopover(null)}
          copy={copy}
        />
      ) : null}

      {newDialog ? (
        <NewWisdomDialog
          state={newDialog}
          onChange={setNewDialog}
          onCancel={closeNewDialog}
          onConfirm={handleCreate}
          copy={copy}
        />
      ) : null}

      {unsavedTarget ? (
        <UnsavedDialog
          onDiscard={handleConfirmDiscard}
          onCancel={handleCancelDiscard}
          copy={copy}
        />
      ) : null}
    </div>
  );
}

// ── helpers (data hydration) ──────────────────────────────────────────────

function recordToPage(row: DocumentRecord): WisdomPage {
  const { slug, author } = parseWisdomPath(row.path);
  return {
    path: row.path,
    slug,
    author,
    title: row.title ?? basename(row.path),
    body: "",
    status: row.status ?? "published",
    tags: [],
    sources: [],
    updatedTs: Math.floor(row.mtime),
    isPending: false,
    bodyLoaded: false,
    extras: {}
  };
}

function parseWisdomPath(path: string): { slug: string; author?: string } {
  // Strip "wisdom/" prefix and ".md" suffix, then split: "wisdom/foo.md" →
  // { slug: "foo" }; "wisdom/alice/bar.md" → { slug: "bar", author: "alice" }.
  // Anything deeper (wisdom/a/b/c.md) keeps only the deepest two segments
  // as author/slug — matches core's auto-path scheme.
  const stripped = path.replace(/^wisdom\//, "").replace(/\.md$/i, "");
  const parts = stripped.split("/").filter(Boolean);
  if (parts.length === 0) return { slug: "" };
  if (parts.length === 1) return { slug: parts[0] };
  return { author: parts[parts.length - 2], slug: parts[parts.length - 1] };
}

function extractSourcesFromFrontmatter(fm: Record<string, unknown> | undefined): string[] | null {
  if (!fm) return null;
  const raw = fm.sources;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function extractTagsFromFrontmatter(fm: Record<string, unknown> | undefined): string[] | null {
  if (!fm) return null;
  const raw = fm.tags;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function extractStatusFromFrontmatter(fm: Record<string, unknown> | undefined): WisdomStatus | null {
  if (!fm) return null;
  const raw = fm.status;
  if (raw === "draft" || raw === "published" || raw === "favorite" || raw === "archived") {
    return raw;
  }
  return null;
}

// Everything in the frontmatter that we DON'T pull out into dedicated fields
// or that core would silently drop when rebuilt. Core's
// `domains/wisdom/page.py._RESERVED_FRONTMATTER_KEYS` excludes
// {title, status, tags, sources, author, content, handler} from `extras`
// before rewriting the file, so echoing those here would just be churn.
// Everything else (aliases, review_due, custom user keys, ...) MUST be
// echoed back via ``extras`` or core's full-file rewrite drops them.
const RESERVED_FRONTMATTER_KEYS = new Set([
  "title",
  "status",
  "tags",
  "sources",
  "author",
  "content",
  "handler"
]);
function extractExtrasFromFrontmatter(fm: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fm) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (RESERVED_FRONTMATTER_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// ── task polling (small helper around streamTaskEvents + getTaskResult) ──

async function pollWriteTask(args: {
  client: DikwClient;
  taskId: string;
  signal: AbortSignal;
  onTerminal: (report: WisdomWriteReport) => void;
  onError: (err: unknown) => void;
}): Promise<void> {
  const { client, taskId, signal, onTerminal, onError } = args;
  try {
    // Drain the event stream until terminal. The events themselves are
    // informational — we just need to know when the task settles so we can
    // fetch the result envelope. ``streamTaskEvents`` exits on terminal
    // status (succeeded/failed/cancelled).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of client.streamTaskEvents(taskId, 0, signal)) {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    const report = await client.getTaskResult<WisdomWriteReport>(taskId, signal);
    if (signal.aborted) return;
    onTerminal(report);
  } catch (err) {
    if (signal.aborted) return;
    onError(err);
  }
}

// ── presentational subcomponents (unchanged from PR #44 except types) ────

function WisdomTree({
  nodes,
  selectedPath,
  expandedIds,
  onToggle,
  onSelect
}: {
  nodes: WisdomTreeNode[];
  selectedPath: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="wiki-tree" role="tree" aria-label="Wisdom directory">
      {nodes.map((node) => (
        <WisdomTreeNodeView
          key={node.id}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function WisdomTreeNodeView({
  node,
  depth,
  selectedPath,
  expandedIds,
  onToggle,
  onSelect
}: {
  node: WisdomTreeNode;
  depth: number;
  selectedPath: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}) {
  if (node.page) {
    const isSelected = selectedPath === node.page.path;
    return (
      <div role="treeitem" aria-label={node.page.title} aria-selected={isSelected}>
        <button
          className={`wiki-tree__item wiki-tree__item--file ${isSelected ? "is-selected" : ""} ${node.page.isPending ? "wiki-tree__item--pending" : ""}`}
          type="button"
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => node.page && onSelect(node.page.path)}
        >
          <FileText size={15} aria-hidden="true" />
          <span>
            <strong>{node.page.title}</strong>
            <small>{node.page.isPending ? "(unsaved)" : truncateMiddle(node.page.path, 48)}</small>
          </span>
        </button>
      </div>
    );
  }
  const expanded = expandedIds.has(node.id);
  const FolderIcon = expanded ? FolderOpen : Folder;
  const isRoot = node.id === "wisdom";
  return (
    <div role="treeitem" aria-label={node.name} aria-expanded={expanded}>
      <button
        className={`wiki-tree__item wiki-tree__item--folder ${isRoot ? "wiki-tree__item--root" : ""}`}
        type="button"
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        onClick={() => onToggle(node.id)}
      >
        {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <FolderIcon size={15} aria-hidden="true" />
        <strong>{node.name}</strong>
      </button>
      {expanded ? (
        <div role="group">
          {node.children.map((child) => (
            <WisdomTreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WisdomReadAside({
  backlinks,
  sources,
  onOpen,
  copy
}: {
  backlinks: Array<{ path: string; title: string }>;
  sources: string[];
  onOpen: (path: string) => void;
  copy: WisdomCopy;
}) {
  if (!backlinks.length && !sources.length) return null;
  return (
    <div className="wisdom-aside" aria-label={copy.asideRegion}>
      {backlinks.length ? (
        <section className="wiki-backlinks" aria-label={copy.linkedRefsTitle}>
          <h2 className="wiki-backlinks__title">{copy.linkedRefsTitle}</h2>
          <ul className="wiki-backlinks__list">
            {backlinks.map((ref) => (
              <li className="wiki-backlinks__item" key={ref.path}>
                <button type="button" className="inline-wikilink" onClick={() => onOpen(ref.path)}>
                  {ref.title}
                </button>
                <span className="soft-label wiki-backlinks__layer">W</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sources.length ? (
        <section className="wiki-backlinks wisdom-sources" aria-label={copy.sourcesTitle}>
          <h2 className="wiki-backlinks__title">{copy.sourcesTitle}</h2>
          <ul className="wiki-backlinks__list">
            {sources.map((path) => (
              <li className="wiki-backlinks__item" key={path}>
                <span className="wisdom-source-path">{path}</span>
                <span className="soft-label wiki-backlinks__layer">D</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function WisdomEditor({
  draft,
  saving,
  savingMessage,
  textareaRef,
  onChangeBody,
  onRemoveSource,
  onOpenRefPopover,
  onOpenSourcesPopover,
  onSave,
  copy
}: {
  draft: { body: string; sources: string[] };
  saving: boolean;
  savingMessage: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChangeBody: (body: string) => void;
  onRemoveSource: (path: string) => void;
  onOpenRefPopover: () => void;
  onOpenSourcesPopover: () => void;
  onSave: () => void;
  copy: WisdomCopy;
}) {
  return (
    <section className="wiki-reader-tab-panel wisdom-edit-panel" role="tabpanel" aria-label={copy.editTab}>
      <div className="wisdom-editor">
        <div className="wisdom-editor__body-header wisdom-editor__section-header">
          <h3 className="wiki-backlinks__title">{copy.body}</h3>
          <button
            type="button"
            className="secondary-button wisdom-editor__add-button"
            onClick={onOpenRefPopover}
            disabled={saving}
            aria-label={copy.addWikilink}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{copy.addWikilink}</span>
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="wisdom-editor__textarea"
          value={draft.body}
          onChange={(event) => onChangeBody(event.target.value)}
          aria-label={copy.bodyLabel}
          spellCheck={false}
          disabled={saving}
        />
        <div className="wisdom-editor__sources" aria-label={copy.sourcesTitle}>
          <div className="wisdom-editor__section-header">
            <h3 className="wiki-backlinks__title">{copy.sourcesTitle}</h3>
            <button
              type="button"
              className="secondary-button wisdom-editor__add-button"
              onClick={onOpenSourcesPopover}
              disabled={saving}
              aria-label={copy.addSource}
            >
              <Plus size={14} aria-hidden="true" />
              <span>{copy.addSource}</span>
            </button>
          </div>
          {draft.sources.length ? (
            <ul className="wiki-backlinks__list">
              {draft.sources.map((path) => (
                <li className="wiki-backlinks__item" key={path}>
                  <span className="wisdom-source-path">{path}</span>
                  <button
                    type="button"
                    className="icon-button wisdom-source-remove"
                    onClick={() => onRemoveSource(path)}
                    aria-label={copy.removeSourceAria.replace("{path}", path)}
                    disabled={saving}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="soft-label wisdom-editor__sources-empty">{copy.sourcesEmpty}</p>
          )}
        </div>
      </div>
      <div className="wisdom-edit-actions">
        {saving && savingMessage ? (
          <span className="soft-label wisdom-edit-actions__status" role="status" aria-live="polite">
            {savingMessage}
          </span>
        ) : null}
        <button
          type="button"
          className="primary-button"
          onClick={onSave}
          disabled={saving}
          aria-label={copy.saveAria}
        >
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </section>
  );
}

function ReferencePopover({
  mode,
  query,
  wisdomCandidates,
  kCandidates,
  dCandidates,
  candidatesLoading,
  onQueryChange,
  onPick,
  onClose,
  copy
}: {
  mode: RefMode;
  query: string;
  wisdomCandidates: WisdomCandidate[];
  kCandidates: WisdomCandidate[];
  dCandidates: WisdomCandidate[];
  candidatesLoading: boolean;
  onQueryChange: (query: string) => void;
  onPick: (value: string) => void;
  onClose: () => void;
  copy: WisdomCopy;
}) {
  // Dedup the merged K+W list by path so React doesn't see two <li
  // key={c.path}> with the same key when a K-candidate path happens to
  // collide with a wisdom page path.
  const candidates = useMemo<WisdomCandidate[]>(() => {
    if (mode !== "wikilink") return dCandidates;
    const seen = new Set<string>();
    const merged: WisdomCandidate[] = [];
    for (const c of [...kCandidates, ...wisdomCandidates]) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      merged.push(c);
    }
    return merged;
  }, [mode, wisdomCandidates, kCandidates, dCandidates]);
  const dialogLabel = mode === "wikilink" ? copy.addWikilink : copy.addSource;
  const searchLabel = mode === "wikilink" ? copy.refSearchWikilink : copy.refSearchD;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? candidates.filter((c) => `${c.title} ${c.path}`.toLowerCase().includes(needle))
      : candidates;
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [candidates, query]);

  return (
    <div className="wisdom-popover-shroud" role="presentation" onClick={onClose}>
      <div
        className="wisdom-popover"
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wisdom-popover__header">
          <div className="wisdom-popover__title">
            <h2>{dialogLabel}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={copy.close}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="wisdom-popover__search">
          <Search size={14} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
          />
        </label>
        <ul className="wisdom-popover__list" role="listbox" aria-label={copy.refResults}>
          {candidatesLoading && !filtered.length ? (
            <li className="wisdom-popover__empty">{copy.refLoading}</li>
          ) : filtered.length ? (
            filtered.map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  className="wisdom-popover__item"
                  onClick={() => onPick(mode === "wikilink" ? c.title : c.path)}
                >
                  <span className="wisdom-popover__item-row">
                    <span className={`wisdom-popover__item-layer wisdom-popover__item-layer--${c.layer}`}>
                      {copy.layerLabel[c.layer]}
                    </span>
                    <strong>{c.title}</strong>
                  </span>
                  <small>{c.path}</small>
                  {c.excerpt ? <span>{c.excerpt}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="wisdom-popover__empty">{copy.refEmpty}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function NewWisdomDialog({
  state,
  onChange,
  onCancel,
  onConfirm,
  copy
}: {
  state: NewDialogState;
  onChange: (next: NewDialogState) => void;
  onCancel: () => void;
  onConfirm: () => void;
  copy: WisdomCopy;
}) {
  return (
    <div className="wisdom-popover-shroud" role="presentation" onClick={onCancel}>
      <div
        className="wisdom-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy.newButton}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wisdom-dialog__header">
          <h2>{copy.newDialogTitle}</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={copy.close}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form
          className="wisdom-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <label className="field">
            <span>{copy.newTitle}</span>
            <input
              autoFocus
              value={state.title}
              onChange={(event) => onChange({ ...state, title: event.target.value, error: null })}
            />
          </label>
          <label className="field">
            <span>{copy.newSlug}</span>
            <input
              value={state.slug}
              placeholder="e.g. release-checklist"
              onChange={(event) => onChange({ ...state, slug: event.target.value, error: null })}
            />
          </label>
          <label className="field">
            <span>{copy.newAuthor}</span>
            <input
              value={state.author}
              placeholder="optional"
              onChange={(event) => onChange({ ...state, author: event.target.value, error: null })}
            />
          </label>
          <p className="soft-label wisdom-dialog__hint">
            {copy.newPathHint.replace(
              "{path}",
              state.author.trim()
                ? `wisdom/${state.author.trim()}/${state.slug.trim() || "<slug>"}.md`
                : `wisdom/${state.slug.trim() || "<slug>"}.md`
            )}
          </p>
          {state.error ? <p className="wisdom-dialog__error" role="alert">{state.error}</p> : null}
          <div className="wisdom-dialog__actions">
            <button type="button" className="secondary-button" onClick={onCancel}>
              {copy.cancel}
            </button>
            <button type="submit" className="primary-button">
              {copy.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UnsavedDialog({
  onDiscard,
  onCancel,
  copy
}: {
  onDiscard: () => void;
  onCancel: () => void;
  copy: WisdomCopy;
}) {
  return (
    <div className="wisdom-popover-shroud" role="presentation" onClick={onCancel}>
      <div
        className="wisdom-dialog wisdom-dialog--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.unsavedTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wisdom-dialog__header">
          <h2>{copy.unsavedTitle}</h2>
        </div>
        <p className="wisdom-dialog__body">{copy.unsavedBody}</p>
        <div className="wisdom-dialog__actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {copy.cancel}
          </button>
          <button type="button" className="primary-button" onClick={onDiscard}>
            {copy.discard}
          </button>
        </div>
      </div>
    </div>
  );
}

function WisdomStatusChip({ status, locale }: { status: WisdomStatus; locale: Locale }) {
  const labels = translations[locale].pages.wisdom.statusChip;
  return <span className={`status-pill status-pill--wisdom-${status}`}>{labels[status]}</span>;
}

type WisdomCopy = (typeof translations)["en"]["pages"]["wisdom"];

// ── small helpers (unchanged logic from PR #44 except types) ─────────────

function firstBodyLine(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    i = j + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    return line.length > 96 ? `${line.slice(0, 93)}…` : line;
  }
  return "";
}

function pageIsDirty(page: WisdomPage, draft: { body: string; sources: string[] }): boolean {
  if (draft.body !== page.body) return true;
  if (draft.sources.length !== page.sources.length) return true;
  for (let i = 0; i < draft.sources.length; i += 1) {
    if (draft.sources[i] !== page.sources[i]) return true;
  }
  return false;
}

function buildWisdomTree(pages: WisdomPage[]): WisdomTreeNode[] {
  const root: WisdomTreeNode = { id: "wisdom", name: "wisdom", children: [], page: null };
  for (const p of pages) {
    // Pending drafts use the unique slug (with optional author segment) as
    // the leaf id so two unsaved drafts with the same title can coexist in
    // the tree. The display name still comes from p.title below.
    const parts = p.isPending
      ? ["wisdom", "(pending)", p.author ? `${p.author}__${p.slug}` : p.slug]
      : p.path.split("/").filter(Boolean);
    let current = root;
    for (let i = 1; i < parts.length; i += 1) {
      const part = parts[i];
      const id = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let child = current.children.find((c) => c.id === id);
      if (!child) {
        child = {
          id,
          name: isFile ? p.title || basename(p.path) : part,
          children: [],
          page: isFile ? p : null
        };
        current.children.push(child);
      } else if (isFile) {
        child.page = p;
        child.name = p.title || basename(p.path);
      }
      current = child;
    }
  }
  sortTree(root);
  return [root];
}

function sortTree(node: WisdomTreeNode) {
  node.children.sort((a, b) => {
    if (Boolean(a.page) !== Boolean(b.page)) return a.page ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

function collectDirectoryIds(nodes: WisdomTreeNode[], acc: Set<string>) {
  for (const node of nodes) {
    if (!node.page) {
      acc.add(node.id);
      collectDirectoryIds(node.children, acc);
    }
  }
}

function collectPathAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

function pathIsInsideDirectory(path: string, directoryId: string): boolean {
  return directoryId === "wisdom" || path === directoryId || path.startsWith(`${directoryId}/`);
}

function formatCount(n: number, template: { one: string; many: string }): string {
  return (n === 1 ? template.one : template.many).replace("{n}", String(n));
}

// Encode each path segment for URL interpolation (kept consistent with
// WikiPage.encodePath). Without this a path containing `?`, `#`, `%`, a
// space, or any non-ASCII character would either truncate at the
// fragment / query boundary or be ambiguously routed.
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
