import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const API_BASE = "https://context7.com/api/v2";
const API_KEY = process.env.CONTEXT7_API_KEY;

// Context7 indexes major open-source libraries from their GitHub repositories.
// It provides source-annotated code snippets, never stale (sourced from live
// branches like main/canary). For obscure or niche packages, fall back to
// web_search or code_search.

export default function (pi: ExtensionAPI) {
  if (!API_KEY) {
    console.warn("context7: CONTEXT7_API_KEY not set — tools will fail");
  }

  // ── resolve_library_id ───────────────────────────────────────────
  pi.registerTool({
    name: "resolve_library_id",
    label: "Resolve Library ID",
    description:
      "Search Context7 for a library and get its Context7-compatible ID. " +
      "Call this BEFORE query_docs when you don't know the library ID. " +
      "Returns matching libraries with IDs, descriptions, code snippet counts, " +
      "benchmark scores, and available versions.\n\n" +
      "IMPORTANT — library name matching is fuzzy, not exact. If the obvious " +
      "name returns unexpected results, try the full project name (e.g., " +
      "'ruby on rails' not just 'rails', 'next.js' not 'next', 'react' for " +
      "React core, 'prisma' for Prisma). For GitHub org/repo patterns, try " +
      "that directly (e.g., 'rails/rails'). Use the query parameter with the " +
      "user's question to rank results by relevance.",
    promptSnippet: "Resolve a library name to a Context7 library ID",
    promptGuidelines: [
      "Use resolve_library_id when the user asks a question about a library/package and you don't know the Context7 library ID. After getting the ID, call query_docs with it.",
      "For resolve_library_id: library name matching is fuzzy. If the obvious short name ('rails', 'next') returns sub-libraries instead of the core project, search again with the full project name ('ruby on rails', 'next.js') or org/repo format ('rails/rails').",
    ],
    parameters: Type.Object({
      libraryName: Type.String({
        description:
          "Library name to search for (e.g., 'react', 'next.js', 'rails', 'prisma')",
      }),
      query: Type.Optional(
        Type.String({
          description:
            "The user's question or task — used to rank results by relevance",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const url = new URL(`${API_BASE}/libs/search`);
      url.searchParams.set("libraryName", params.libraryName);
      if (params.query) url.searchParams.set("query", params.query);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return {
          content: [
            {
              type: "text" as const,
              text: `Context7 library search failed (${res.status}): ${(err as any).message || res.statusText}`,
            },
          ],
          details: { error: res.status, message: (err as any).message },
        };
      }

      const data = (await res.json()) as {
        results: Array<{
          id: string;
          title: string;
          description: string;
          totalSnippets: number;
          trustScore: number;
          benchmarkScore: number;
          versions: string[];
        }>;
      };

      // Context7 returns 200 with error object for "no results"
      const apiError = (data as any).error;
      if (apiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No libraries found for "${params.libraryName}": ${(data as any).message || apiError}. Try a longer name (e.g., 'ruby on rails' not 'rails') or search with the GitHub org/repo format.`,
            },
          ],
        };
      }

      if (!data.results?.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No libraries found for "${params.libraryName}". Try a different name or use web_search/code_search for this query.`,
            },
          ],
        };
      }

      const text = data.results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n` +
            `   ID: \`${r.id}\`\n` +
            `   Description: ${r.description}\n` +
            `   Snippets: ${r.totalSnippets} | Trust: ${r.trustScore} | Benchmark: ${r.benchmarkScore}\n` +
            (r.versions?.length
              ? `   Versions: ${r.versions.slice(0, 8).join(", ")}${r.versions.length > 8 ? "..." : ""}\n`
              : "")
        )
        .join("\n");

      return {
        content: [
          { type: "text" as const, text },
        ],
        details: { results: data.results },
      };
    },
  });

  // ── query_docs ────────────────────────────────────────────────────
  pi.registerTool({
    name: "query_docs",
    label: "Query Docs",
    description:
      "Query library documentation via Context7. Returns ranked, up-to-date " +
      "code snippets and documentation from the library's source repository. " +
      "Snippets include source file paths pointing to the exact source file " +
      "they came from. Use after resolve_library_id to get the correct library " +
      "ID. Accepts version-pinned IDs like '/vercel/next.js/v15.1.8'.\n\n" +
      "Context7 covers major open-source libraries (Rails, React, Next.js, " +
      "Prisma, etc.). For niche/obscure packages not indexed by Context7, " +
      "fall back to web_search or code_search.",
    promptSnippet: "Query up-to-date library docs and code examples from Context7",
    promptGuidelines: [
      "Use query_docs when the user asks how to do something with a specific library. Call resolve_library_id first to get the library ID, then query_docs with that ID and the user's question. Prefer query_docs over web_search for library-specific API questions — the results come directly from the library's source code and official docs, never stale.",
      "For query_docs: always use the exact libraryId returned by resolve_library_id (starts with '/'). Make the query parameter specific and detailed — include what you're building, which APIs/patterns you need, and any constraints.",
    ],
    parameters: Type.Object({
      libraryId: Type.String({
        description:
          "Context7 library ID from resolve_library_id (e.g., '/rails/rails', '/vercel/next.js', '/reactjs/react.dev'). Append version: '/vercel/next.js/v15.1.8'",
      }),
      query: Type.String({
        description:
          "Specific question or task. Be detailed — include what you're trying to build, which APIs/patterns you need, and any constraints.",
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const url = new URL(`${API_BASE}/context`);
      url.searchParams.set("libraryId", params.libraryId);
      url.searchParams.set("query", params.query);
      url.searchParams.set("type", "txt");

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return {
          content: [
            {
              type: "text" as const,
              text: `Context7 docs query failed (${res.status}): ${(err as any).message || res.statusText}`,
            },
          ],
          details: { error: res.status, message: (err as any).message },
        };
      }

      const text = await res.text();

      if (!text.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documentation found for ${params.libraryId} matching "${params.query}".`,
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  });
}
