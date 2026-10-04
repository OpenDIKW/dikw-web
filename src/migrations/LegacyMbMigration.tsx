import { useState } from "react";
import { Button, Notice } from "@opendikw/web-ui/controls";
import { downloadLegacyMbData } from "./legacyMbExport";
import { resolveMbWebUrl } from "../config/mbWebUrl";
export function LegacyMbMigration({ mbWebUrl }: { mbWebUrl?: string }) {
  const [error, setError] = useState("");
  const target = resolveMbWebUrl(mbWebUrl);
  return (
    <main
      className="legacy-mb-migration panel"
      style={{ maxWidth: "48rem", margin: "2rem auto", padding: "1.5rem" }}
    >
      <h1>迈博应用已迁移</h1>
      <p>
        论文研究与笔记应用已独立部署。请先导出这个浏览器中的旧笔记与论文别名，再登录新应用，在设置中导入文件。
      </p>
      <p>导出会保留这里的原数据；文件只包含笔记与论文别名，不包含登录凭证、连接信息或缓存。</p>
      <Button
        onClick={() => {
          try {
            downloadLegacyMbData();
            setError("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "无法导出旧数据。");
          }
        }}
      >
        导出旧笔记与论文别名
      </Button>
      {target ? (
        <p>
          <a href={target} rel="noopener noreferrer">
            打开新迈博应用
          </a>
        </p>
      ) : (
        <p>新应用地址尚未配置，请联系管理员。你仍然可以导出旧数据。</p>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </main>
  );
}
