// Local mock data for the Phase 1 #trace page. Mirrors exactly what the Phase 3
// backend will return (AgentSession from getSession, SessionTraceView from
// getSessionTraces), so wiring the real endpoints later only swaps the data
// source — the render tree stays put. Not shipped behind any real network call.

import type { AgentSession } from "../agent/types";
import type { SessionTraceView } from "../agent/traceTypes";

const T0 = 1_717_488_000_000; // arbitrary fixed epoch ms — keeps tests deterministic

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

export const mockTraceSessions: AgentSession[] = [
  {
    id: "trace-demo-architecture",
    title: "What is the DIKW architecture?",
    createdAt: iso(0),
    updatedAt: iso(4_200),
    messageCount: 2,
    lastMessagePreview: "DIKW stacks data → information → knowledge → wisdom…",
    messages: [
      { id: "m1", role: "user", content: "What is the DIKW architecture?", createdAt: iso(0) },
      {
        id: "m2",
        role: "assistant",
        content:
          "DIKW stacks data → information → knowledge → wisdom. dikw-core retrieves the evidence and the agent composes the answer, citing the source pages it read.",
        createdAt: iso(4_180)
      }
    ],
    toolEvents: [
      { id: "fc-retrieve", type: "tool_call", name: "retrieve_knowledge", status: "succeeded", createdAt: iso(940) },
      { id: "fc-web", type: "tool_call", name: "web_search", status: "failed", createdAt: iso(2_460) }
    ],
    sources: [
      { path: "knowledge/concepts/dikw-architecture.md", title: "DIKW Architecture", layer: "knowledge", score: 0.91 }
    ],
    proposals: []
  },
  {
    id: "trace-demo-wisdom",
    title: "List the wisdom items",
    createdAt: iso(60_000),
    updatedAt: iso(61_900),
    messageCount: 2,
    lastMessagePreview: "There are 3 wisdom items in the base…",
    messages: [
      { id: "m1", role: "user", content: "List the wisdom items.", createdAt: iso(60_000) },
      {
        id: "m2",
        role: "assistant",
        content: "There are 3 wisdom items in the base: onboarding-playbook, retrieval-tuning, and review-cadence.",
        createdAt: iso(61_880)
      }
    ],
    toolEvents: [{ id: "fc-wisdom", type: "tool_call", name: "list_wisdom", status: "succeeded", createdAt: iso(60_300) }],
    sources: [],
    proposals: []
  }
];

export const mockTraceViews: Record<string, SessionTraceView> = {
  "trace-demo-architecture": {
    sessionId: "trace-demo-architecture",
    invocations: [
      {
        invocationId: "inv-arch-1",
        startTimeMs: T0,
        durationMs: 4_200,
        spans: [
          {
            spanId: "s0",
            parentSpanId: null,
            name: "invocation",
            startTimeMs: T0,
            durationMs: 4_200,
            status: "ok",
            attributes: { "gcp.vertex.agent.invocation_id": "inv-arch-1" }
          },
          {
            spanId: "s1",
            parentSpanId: "s0",
            name: "invoke_agent dikw_agent",
            startTimeMs: T0 + 5,
            durationMs: 4_185,
            status: "ok",
            attributes: { "gen_ai.agent.name": "dikw_agent", "gen_ai.conversation.id": "trace-demo-architecture" }
          },
          {
            spanId: "s2",
            parentSpanId: "s1",
            name: "call_llm",
            startTimeMs: T0 + 20,
            durationMs: 900,
            status: "ok",
            attributes: { "gen_ai.request.model": "MiniMax-M3", "gen_ai.response.finish_reasons": "tool_use" },
            tokensInput: 1_240,
            tokensOutput: 58
          },
          {
            spanId: "s3",
            parentSpanId: "s1",
            name: "execute_tool retrieve_knowledge",
            startTimeMs: T0 + 940,
            durationMs: 1_500,
            status: "ok",
            attributes: {
              "gen_ai.tool.name": "retrieve_knowledge",
              "gcp.vertex.agent.tool_call_args": '{"q":"DIKW architecture","limit":10}'
            }
          },
          {
            spanId: "s4",
            parentSpanId: "s1",
            name: "execute_tool web_search",
            startTimeMs: T0 + 2_460,
            durationMs: 760,
            status: "error",
            attributes: { "gen_ai.tool.name": "web_search", error: "web_search requires DIKW_AGENT_TAVILY_API_KEY" }
          },
          {
            spanId: "s5",
            parentSpanId: "s1",
            name: "call_llm",
            startTimeMs: T0 + 3_280,
            durationMs: 900,
            status: "ok",
            attributes: { "gen_ai.request.model": "MiniMax-M3", "gen_ai.response.finish_reasons": "stop" },
            tokensInput: 2_610,
            tokensOutput: 320
          }
        ]
      }
    ]
  },
  "trace-demo-wisdom": {
    sessionId: "trace-demo-wisdom",
    invocations: [
      {
        invocationId: "inv-wisdom-1",
        startTimeMs: T0 + 60_000,
        durationMs: 1_900,
        spans: [
          {
            spanId: "w0",
            parentSpanId: null,
            name: "invocation",
            startTimeMs: T0 + 60_000,
            durationMs: 1_900,
            status: "ok",
            attributes: { "gcp.vertex.agent.invocation_id": "inv-wisdom-1" }
          },
          {
            spanId: "w1",
            parentSpanId: "w0",
            name: "invoke_agent dikw_agent",
            startTimeMs: T0 + 60_005,
            durationMs: 1_890,
            status: "ok",
            attributes: { "gen_ai.agent.name": "dikw_agent", "gen_ai.conversation.id": "trace-demo-wisdom" }
          },
          {
            spanId: "w2",
            parentSpanId: "w1",
            name: "call_llm",
            startTimeMs: T0 + 60_020,
            durationMs: 280,
            status: "ok",
            attributes: { "gen_ai.request.model": "MiniMax-M3", "gen_ai.response.finish_reasons": "tool_use" },
            tokensInput: 980,
            tokensOutput: 32
          },
          {
            spanId: "w3",
            parentSpanId: "w1",
            name: "execute_tool list_wisdom",
            startTimeMs: T0 + 60_300,
            durationMs: 410,
            status: "ok",
            attributes: { "gen_ai.tool.name": "list_wisdom" }
          },
          {
            spanId: "w4",
            parentSpanId: "w1",
            name: "call_llm",
            startTimeMs: T0 + 60_720,
            durationMs: 1_160,
            status: "ok",
            attributes: { "gen_ai.request.model": "MiniMax-M3", "gen_ai.response.finish_reasons": "stop" },
            tokensInput: 1_520,
            tokensOutput: 140
          }
        ]
      }
    ]
  }
};
