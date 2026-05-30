/**
 * Rewrite a legacy `wiki/` path prefix to the current `knowledge/` prefix.
 *
 * dikw-core renamed the K-layer path prefix from `wiki/` to `knowledge/` in
 * 0.4.0. Live core already returns `knowledge/`, but chat sessions persisted in
 * `.agent-sessions/` before the rename still carry `wiki/` source paths. This
 * normalizes such legacy paths at the display boundary. Only a leading `wiki/`
 * segment is rewritten — lookalikes (`wikipedia/…`) and mid-path occurrences are
 * left untouched.
 */
export function normalizeKnowledgePath(path: string): string {
  return path.replace(/^wiki\//, "knowledge/");
}
