import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { translations, type Locale } from "../i18n";
import { basename, formatUnixSeconds, truncateMiddle } from "../utils/format";
import { injectInlineRefs } from "../utils/source-inline-refs";
import {
  wisdomMockDCandidates,
  wisdomMockKCandidates,
  wisdomMockPages,
  type WisdomMockCandidate,
  type WisdomMockPage,
  type WisdomMockStatus
} from "./__mock__/wisdom-data";

interface WisdomPageProps {
  client: DikwClient;
  locale?: Locale;
}

interface WisdomTreeNode {
  id: string;
  name: string;
  children: WisdomTreeNode[];
  page: WisdomMockPage | null;
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
  | { kind: "create"; page: WisdomMockPage }
  | { kind: "collapseDir"; dirId: string };

const SAVE_DELAY_MS = 800;

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function WisdomPage({ client: _client, locale = "en" }: WisdomPageProps) {
  const copy = translations[locale].pages.wisdom;

  const [pages, setPages] = useState<WisdomMockPage[]>(() => wisdomMockPages.map(clonePage));
  const [selectedPath, setSelectedPath] = useState<string | null>(() => wisdomMockPages[0]?.path ?? null);
  const [filter, setFilter] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(["wisdom"]));
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState<{ body: string; sources: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newDialog, setNewDialog] = useState<NewDialogState | null>(null);
  const [refPopover, setRefPopover] = useState<{ mode: RefMode; query: string } | null>(null);
  const [unsavedTarget, setUnsavedTarget] = useState<UnsavedTarget | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [unresolvedWikiLink, setUnresolvedWikiLink] = useState<string | null>(null);

  const visiblePages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let next = pages;
    if (starredOnly) next = next.filter((p) => p.status === "favorite");
    if (!needle) return next;
    return next.filter((p) => `${p.path} ${p.title}`.toLowerCase().includes(needle));
  }, [filter, pages, starredOnly]);

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
    () => pages.find((p) => p.path === selectedPath) ?? null,
    [pages, selectedPath]
  );

  // Derive wisdom-to-wisdom backlinks: scan every page body for [[Title]]
  // tokens and group by target title.
  const backlinksByPath = useMemo(() => derivePageBacklinks(pages), [pages]);

  // Run the same inline-ref injection as the Source layer reader: backlink titles
  // that appear literally in the wisdom body become `[[title|literal]]`. Only
  // un-inlined refs land in the bottom aside (mirrors WikiPage source flow).
  const enhancedReadBody = useMemo(() => {
    if (!selected) return { body: "", matchedPaths: new Set<string>() };
    const refs = backlinksByPath.get(selected.path) ?? [];
    return injectInlineRefs(selected.body, refs);
  }, [selected, backlinksByPath]);

  const unmatchedBacklinks = useMemo(() => {
    if (!selected) return [];
    const all = backlinksByPath.get(selected.path) ?? [];
    return all.filter((b) => !enhancedReadBody.matchedPaths.has(b.path));
  }, [selected, backlinksByPath, enhancedReadBody.matchedPaths]);

  const isDirty = mode === "edit" && draft !== null && selected !== null && pageIsDirty(selected, draft);

  const requestNavigate = (target: UnsavedTarget) => {
    if (mode === "edit" && isDirty) {
      setUnsavedTarget(target);
      return;
    }
    applyNavigate(target);
  };

  const cancelPendingSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      setSaving(false);
    }
  };

  const applyCreate = (page: WisdomMockPage) => {
    cancelPendingSave();
    setPages((prev) => [...prev, page]);
    setNewDialog(null);
    setSelectedPath(page.path);
    setDraft({ body: "", sources: [...page.sources] });
    setMode("edit");
  };

  const applyNavigate = (target: UnsavedTarget) => {
    cancelPendingSave();
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
    setDraft({ body: selected.body, sources: [...selected.sources] });
    setMode("edit");
  };

  const enterReadMode = () => {
    if (mode === "read") return;
    requestNavigate({ kind: "read" });
  };

  const handleSave = () => {
    if (!selected || !draft) return;
    setSaving(true);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      setPages((prev) =>
        prev.map((p) =>
          p.path === selected.path
            ? { ...p, body: draft.body, sources: [...draft.sources], updatedTs: Math.floor(Date.now() / 1000) }
            : p
        )
      );
      setSaving(false);
      setDraft(null);
      setMode("read");
    }, SAVE_DELAY_MS);
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
    const path = author ? `wisdom/${author}/${slug}.md` : `wisdom/${slug}.md`;
    // Compare lower-cased paths so case-insensitive filesystems (Windows,
    // macOS APFS default) don't see "wisdom/Team/..." and "wisdom/team/..."
    // as distinct entries.
    const pathLower = path.toLowerCase();
    if (pages.some((p) => p.path.toLowerCase() === pathLower)) {
      setNewDialog({ ...newDialog, error: copy.newError.duplicate });
      return;
    }
    const created: WisdomMockPage = {
      path,
      slug,
      author,
      title,
      body: "",
      status: "draft",
      tags: [],
      sources: [],
      updatedTs: Math.floor(Date.now() / 1000)
    };
    if (mode === "edit" && isDirty) {
      // Defer creation until the user resolves the dirty draft; same prompt
      // path as tree/tab navigation. Leave newDialog mounted so canceling the
      // discard prompt returns the user to their filled-in form instead of
      // discarding their typed title/slug/author.
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
    // Restore caret after React updates the textarea value.
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

  const toggleFavorite = (path: string) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.path !== path) return p;
        const updatedTs = Math.floor(Date.now() / 1000);
        if (p.status === "favorite") {
          // Restore the pre-star lifecycle; "published" is the default when
          // the page was seeded as favorite without a recorded prior state.
          return { ...p, status: p.preStarStatus ?? "published", preStarStatus: undefined, updatedTs };
        }
        // Remember the current lifecycle so un-favorite can put it back.
        return { ...p, status: "favorite", preStarStatus: p.status, updatedTs };
      })
    );
  };

  const handleWikiLinkClick = (target: string) => {
    const lower = target.trim().toLowerCase();
    const match = pages.find((p) => p.title.toLowerCase() === lower);
    if (match) {
      handleSelectPage(match.path);
      return;
    }
    // Target lives outside the wisdom layer (typically a K-page in the
    // mock). Surface a transient notice instead of silently no-op'ing.
    setUnresolvedWikiLink(target);
  };

  // Single Escape handler for all stacked dialogs (priority: unsaved >
  // newDialog > refPopover). Also clears the in-flight save timer on unmount
  // so a deferred setState never fires on a torn-down tree.
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

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  // Close the reference popover if a save kicks off while it's open — the
  // editor textarea is disabled during the 800ms save window, so any pick
  // would land in a draft about to be discarded.
  useEffect(() => {
    if (saving) setRefPopover(null);
  }, [saving]);

  // Auto-dismiss the transient unresolved-wikilink banner after a short
  // delay so it doesn't accumulate across clicks.
  useEffect(() => {
    if (!unresolvedWikiLink) return;
    const t = window.setTimeout(() => setUnresolvedWikiLink(null), 2400);
    return () => window.clearTimeout(t);
  }, [unresolvedWikiLink]);

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.mockNotice}</p>
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
          {visiblePages.length ? (
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
          {unresolvedWikiLink ? (
            <div className="wisdom-toast" role="status" aria-live="polite">
              {copy.unresolvedWikilink.replace("{title}", unresolvedWikiLink)}
            </div>
          ) : null}
          {selected ? (
            <>
              <div className="reader-header reader-header--stacked">
                <div className="reader-header__path">{selected.path}</div>
                <div className="reader-header__meta reader-header__meta--inline">
                  <span className="soft-label">{formatUnixSeconds(selected.updatedTs)}</span>
                  <button
                    type="button"
                    className={`wisdom-star ${selected.status === "favorite" ? "is-on" : ""}`}
                    onClick={() => toggleFavorite(selected.path)}
                    aria-pressed={selected.status === "favorite"}
                    aria-label={selected.status === "favorite" ? copy.unfavorite : copy.favorite}
                    title={selected.status === "favorite" ? copy.unfavorite : copy.favorite}
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
                  textareaRef={textareaRef}
                  onChangeBody={(body) => setDraft((d) => (d ? { ...d, body } : { body, sources: [...selected.sources] }))}
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
          wisdomCandidates={pages
            .filter((p) => p.path !== selectedPath)
            .map<WisdomMockCandidate>((p) => ({
              path: p.path,
              title: p.title,
              layer: "w",
              excerpt: firstBodyLine(p.body)
            }))}
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
          className={`wiki-tree__item wiki-tree__item--file ${isSelected ? "is-selected" : ""}`}
          type="button"
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => node.page && onSelect(node.page.path)}
        >
          <FileText size={15} aria-hidden="true" />
          <span>
            <strong>{node.page.title}</strong>
            <small>{truncateMiddle(node.page.path, 48)}</small>
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
  onQueryChange,
  onPick,
  onClose,
  copy
}: {
  mode: RefMode;
  query: string;
  wisdomCandidates: WisdomMockCandidate[];
  onQueryChange: (query: string) => void;
  onPick: (value: string) => void;
  onClose: () => void;
  copy: WisdomCopy;
}) {
  // Dedup the merged K+W list by path so React doesn't see two <li
  // key={c.path}> with the same key when a K-candidate path happens to
  // collide with a wisdom page path.
  const candidates = useMemo<WisdomMockCandidate[]>(() => {
    if (mode !== "wikilink") return wisdomMockDCandidates;
    const seen = new Set<string>();
    const merged: WisdomMockCandidate[] = [];
    for (const c of [...wisdomMockKCandidates, ...wisdomCandidates]) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      merged.push(c);
    }
    return merged;
  }, [mode, wisdomCandidates]);
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
          {filtered.length ? (
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

function WisdomStatusChip({ status, locale }: { status: WisdomMockStatus; locale: Locale }) {
  const labels = translations[locale].pages.wisdom.statusChip;
  return <span className={`status-pill status-pill--wisdom-${status}`}>{labels[status]}</span>;
}

type WisdomCopy = (typeof translations)["en"]["pages"]["wisdom"];

function clonePage(p: WisdomMockPage): WisdomMockPage {
  return { ...p, tags: [...p.tags], sources: [...p.sources] };
}

function firstBodyLine(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  // Skip YAML frontmatter block in its entirety: opens with `---` on the
  // first line, closes with another `---`. Without this guard the loop
  // would surface `title: …` / `tags: …` as the excerpt.
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

function pageIsDirty(page: WisdomMockPage, draft: { body: string; sources: string[] }): boolean {
  if (draft.body !== page.body) return true;
  if (draft.sources.length !== page.sources.length) return true;
  for (let i = 0; i < draft.sources.length; i += 1) {
    if (draft.sources[i] !== page.sources[i]) return true;
  }
  return false;
}

function buildWisdomTree(pages: WisdomMockPage[]): WisdomTreeNode[] {
  const root: WisdomTreeNode = { id: "wisdom", name: "wisdom", children: [], page: null };
  for (const p of pages) {
    const parts = p.path.split("/").filter(Boolean);
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

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function derivePageBacklinks(pages: WisdomMockPage[]): Map<string, Array<{ path: string; title: string }>> {
  // Multimap by title — a single title can point at several pages (mock
  // doesn't enforce uniqueness yet) and we want backlinks to flow to all
  // of them rather than be silently dropped.
  const byTitle = new Map<string, WisdomMockPage[]>();
  for (const p of pages) {
    const key = p.title.toLowerCase();
    const arr = byTitle.get(key);
    if (arr) arr.push(p);
    else byTitle.set(key, [p]);
  }

  const result = new Map<string, Array<{ path: string; title: string }>>();
  for (const source of pages) {
    WIKILINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_RE.exec(source.body)) !== null) {
      const targets = byTitle.get(match[1].trim().toLowerCase());
      if (!targets) continue;
      for (const target of targets) {
        if (target.path === source.path) continue;
        const list = result.get(target.path) ?? [];
        if (!list.some((r) => r.path === source.path)) {
          list.push({ path: source.path, title: source.title });
        }
        result.set(target.path, list);
      }
    }
  }
  return result;
}

function formatCount(n: number, template: { one: string; many: string }): string {
  return (n === 1 ? template.one : template.many).replace("{n}", String(n));
}

