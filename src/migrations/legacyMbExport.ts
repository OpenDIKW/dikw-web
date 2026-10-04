export const MAX_MIGRATION_BYTES = 10 * 1024 * 1024;
export interface LegacyMbExportV1 {
  schema: "dikw-mbweb-migration";
  version: 1;
  notes: unknown[];
  paperNames: Record<string, string>;
}
/** Fixed legacy keys only. This protocol does not depend on private business models. */
export function exportLegacyMbData(storage: Pick<Storage, "getItem">): string {
  let notes: unknown, paperNames: unknown;
  try {
    notes = JSON.parse(storage.getItem("dikw-mb.notes") ?? "[]");
    paperNames = JSON.parse(storage.getItem("dikw-mb.paperNames") ?? "{}");
  } catch {
    throw new Error("旧数据不是有效的 JSON，原数据已保留。");
  }
  if (!Array.isArray(notes) || notes.length > 10_000)
    throw new Error("笔记格式不正确，最多支持 10,000 条笔记。原数据已保留。");
  if (
    !paperNames ||
    typeof paperNames !== "object" ||
    Array.isArray(paperNames) ||
    Object.values(paperNames).some((value) => typeof value !== "string")
  )
    throw new Error("论文别名格式不正确，原数据已保留。");
  const payload: LegacyMbExportV1 = {
    schema: "dikw-mbweb-migration",
    version: 1,
    notes,
    paperNames: paperNames as Record<string, string>,
  };
  const text = JSON.stringify(payload, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_MIGRATION_BYTES)
    throw new Error("迁移文件不能超过 10 MiB，原数据已保留。");
  return text;
}
export function downloadLegacyMbData(): void {
  const text = exportLegacyMbData(localStorage);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "dikw-mbweb-migration.json";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let deferred browser navigation resolve the blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
