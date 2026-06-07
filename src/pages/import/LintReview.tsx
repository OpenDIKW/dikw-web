import { useMemo, useState } from "react";
import { Check, CheckCircle2, XCircle } from "lucide-react";
import type { FixProposal, LintKind } from "../../types";
import { lintKindTone, type ImportCopy } from "./format";

interface LintReviewProps {
  copy: ImportCopy;
  proposals: FixProposal[];
  initialPicked: number[];
  onApply: (picked: number[]) => void;
  onSkipAll: () => void;
}

export function LintReview({
  copy,
  proposals,
  initialPicked,
  onApply,
  onSkipAll,
}: LintReviewProps) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(initialPicked));
  const togglePick = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Group proposals by issue kind, preserving original index for picks. The
  // pick array shape (zero-based indices into the original proposals list)
  // is part of the lint-apply wire contract — see core's routes_lint.py.
  const groups = useMemo(() => {
    const byKind = new Map<LintKind, Array<{ proposal: FixProposal; idx: number }>>();
    proposals.forEach((p, idx) => {
      if (!byKind.has(p.issue_kind)) byKind.set(p.issue_kind, []);
      byKind.get(p.issue_kind)!.push({ proposal: p, idx });
    });
    return Array.from(byKind.entries()).map(([kind, items]) => ({
      kind,
      items,
    }));
  }, [proposals]);

  const allSelected = picked.size === proposals.length;
  const someSelected = picked.size > 0 && !allSelected;

  return (
    <>
      <section className="panel" data-testid="import-lint-review">
        <div className="import-preview-head">
          <div>
            <div className="import-preview-head__title">{copy.lintReviewTitle}</div>
            <div className="import-preview-head__hint">{copy.lintReviewHint}</div>
          </div>
          <div className="import-preview-head__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onSkipAll}
              data-testid="import-lint-skip-all"
            >
              <XCircle size={14} />
              {copy.skipAll}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onApply(Array.from(picked).sort((a, b) => a - b))}
              disabled={picked.size === 0}
              data-testid="import-lint-apply"
            >
              <CheckCircle2 size={16} />
              {copy.applySelected} {picked.size} / {proposals.length}
            </button>
          </div>
        </div>
      </section>

      <div className="import-lint-bar">
        <span
          className={
            "import-lint-checkbox" +
            (allSelected
              ? " import-lint-checkbox--on"
              : someSelected
                ? " import-lint-checkbox--mixed"
                : "")
          }
          aria-hidden="true"
        >
          {allSelected ? <Check size={11} /> : null}
        </span>
        <span className="import-lint-bar__count" data-testid="import-lint-selected-count">
          {copy.lintSelected.replace("{n}", String(picked.size))}
        </span>
        <span className="import-lint-bar__sep">·</span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPicked(new Set(proposals.map((_, i) => i)))}
          data-testid="import-lint-select-all"
        >
          {copy.selectAll}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPicked(new Set())}
          data-testid="import-lint-select-none"
        >
          {copy.selectNone}
        </button>
      </div>

      <div className="import-lint-groups">
        {groups.map((g) => {
          const tone = lintKindTone(g.kind);
          return (
            <section key={g.kind}>
              <div className="import-lint-group__head">
                <span
                  className={
                    "import-lint-group__pill" +
                    (tone === "amber"
                      ? " import-lint-group__pill--amber"
                      : tone === "red"
                        ? " import-lint-group__pill--red"
                        : "")
                  }
                >
                  {copy.lintKinds[g.kind] ?? g.kind}
                </span>
                <span className="import-lint-group__count">
                  {copy.lintGroupCount.replace("{n}", String(g.items.length))}
                </span>
              </div>
              <div className="import-lint-list">
                {g.items.map(({ proposal: p, idx }) => {
                  const on = picked.has(idx);
                  return (
                    <div
                      key={p.proposal_id}
                      className={"import-lint-card" + (on ? "" : " import-lint-card--off")}
                      onClick={() => togglePick(idx)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      data-testid={`import-lint-card-${p.proposal_id}`}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          togglePick(idx);
                        }
                      }}
                    >
                      <span
                        className={
                          "import-lint-checkbox import-lint-card__cb" +
                          (on ? " import-lint-checkbox--on" : "")
                        }
                        aria-hidden="true"
                      >
                        {on ? <Check size={11} /> : null}
                      </span>
                      <div className="import-lint-card__body">
                        <div className="import-lint-card__path">{p.issue_path}</div>
                        <div className="import-lint-card__detail">{p.issue_detail}</div>
                        <div className="import-lint-card__rationale">{p.rationale}</div>
                      </div>
                      <div className="import-lint-card__fix">
                        <div className="import-lint-card__fix-label">{copy.lintProposedFix}</div>
                        <div className="import-lint-card__fix-body">
                          {p.operations.length === 0 ? (
                            <span className="import-lint-card__fix-empty">—</span>
                          ) : (
                            p.operations.map((op, k) => (
                              <div key={k} className="import-lint-card__fix-op">
                                <span className="import-lint-card__fix-op-kind">{op.kind}</span>
                                <span>{op.path}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
