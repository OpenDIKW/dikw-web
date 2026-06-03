import { LlmSummarizer, TokenBasedContextCompactor } from "@google/adk";
import type { BaseContextCompactor, BaseLlm, InvocationContext } from "@google/adk";
import type { CompactionConfig } from "./config.js";

/**
 * Builds the ADK context compactor for one agent turn, or `undefined` when
 * compaction is disabled.
 *
 * The compaction itself is 100% ADK's built-in `TokenBasedContextCompactor` +
 * `LlmSummarizer` (the summarizer reuses the agent's own `BaseLlm`). When it
 * fires, ADK summarizes the oldest events into a persisted `CompactedEvent` and
 * the content processor rebuilds the prompt as `[summary, ...recent raw events]`
 * — so the prompt actually shrinks. The only custom code here is a thin
 * `ResilientContextCompactor` guard (below).
 *
 * THRESHOLD CAVEAT: ADK's `shouldCompact` SUMS each event's prompt-token count,
 * and every model event's count already includes the full prior history. So
 * `tokenThreshold` is an aggregate across the session, NOT the live prompt size
 * — effective compaction triggers somewhat BEFORE the live context literally
 * reaches `ratio` of the window (a conservative bias). Raise
 * `DIKW_AGENT_CONTEXT_WINDOW` / `DIKW_AGENT_COMPACTION_RATIO` to compact later.
 */
export function buildContextCompactor(
  llm: BaseLlm,
  config: CompactionConfig
): BaseContextCompactor | undefined {
  if (!config.enabled) {
    return undefined;
  }
  const tokenThreshold = Math.round(config.contextWindow * config.ratio);
  // ADK uses eventRetentionSize as an array-index boundary in `compact`; a
  // fractional value yields `undefined` retained events and throws (then the
  // resilient wrapper swallows it, silently disabling compaction). Force a
  // positive integer.
  const eventRetentionSize = Math.max(1, Math.floor(config.retention));
  const inner = new TokenBasedContextCompactor({
    tokenThreshold,
    eventRetentionSize,
    summarizer: new LlmSummarizer({ llm })
  });
  return new ResilientContextCompactor(inner);
}

/**
 * Wraps a compactor so a compaction failure never aborts the user's turn:
 * `compact` runs inline in the request pipeline (it calls the summarization
 * LLM), and an unhandled throw there would surface to the user as a turn error.
 * On failure we log and proceed with the un-compacted history (which is still
 * within the model window — compaction is an optimization, not a correctness
 * requirement). `shouldCompact` is a pure read and is forwarded as-is.
 */
class ResilientContextCompactor implements BaseContextCompactor {
  constructor(private readonly inner: BaseContextCompactor) {}

  shouldCompact(invocationContext: InvocationContext): boolean | Promise<boolean> {
    return this.inner.shouldCompact(invocationContext);
  }

  async compact(invocationContext: InvocationContext): Promise<void> {
    try {
      await this.inner.compact(invocationContext);
    } catch (error) {
      console.error("[dikw-agent] context compaction failed; proceeding without compaction:", error);
    }
  }
}
