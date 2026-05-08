/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis and planning.
 * When enabled, only read-only tools are available, and the thinking
 * level is elevated for deeper analysis.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle plan mode
 * - Configurable thinking level for plan mode (default: high)
 * - /approve command to approve a plan and start execution
 * - /deny command to reject a plan and refine it
 * - /plan-thinking command to configure the plan-mode thinking level
 * - Saves/restores original thinking level on toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
	extractTodoItems,
	isSafeCommand,
	isValidThinkingLevel,
	markCompletedSteps,
	type ThinkingLevel,
	type TodoItem,
} from "./utils.js";

// ── Tool sets ────────────────────────────────────────────────────────────────

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PLAN_THINKING_LEVEL: ThinkingLevel = "xhigh";

/**
 * Load the plan-mode thinking level from settings.json.
 * Checks project settings first, then global, then falls back to the default.
 */
function loadPlanThinkingLevel(cwd: string): ThinkingLevel {
	const files = [
		join(cwd, ".pi", "settings.json"),
		join(getAgentDir(), "settings.json"),
	];

	for (const file of files) {
		if (!existsSync(file)) continue;
		try {
			const raw = readFileSync(file, "utf-8");
			const settings = JSON.parse(raw) as { planModeThinkingLevel?: string };
			if (settings.planModeThinkingLevel && isValidThinkingLevel(settings.planModeThinkingLevel)) {
				return settings.planModeThinkingLevel;
			}
		} catch {
			// Ignore parse errors, fall through
		}
	}

	return DEFAULT_PLAN_THINKING_LEVEL;
}

// ── Persistent state shape ───────────────────────────────────────────────────

interface PlanModeState {
	enabled: boolean;
	todos: TodoItem[];
	executing: boolean;
	planThinkingLevel: ThinkingLevel;
	planApproved: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let planApproved = false;
	let todoItems: TodoItem[] = [];
	let planThinkingLevel: ThinkingLevel = DEFAULT_PLAN_THINKING_LEVEL;
	let savedThinkingLevel: ThinkingLevel | null = null;

	// ── CLI flag ─────────────────────────────────────────────────────────────

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	// ── UI helpers ───────────────────────────────────────────────────────────

	function updateStatus(ctx: ExtensionContext): void {
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus(
				"plan-mode",
				ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
			);
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list during execution
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") +
						ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	// ── Plan mode toggle ─────────────────────────────────────────────────────

	function enablePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) return;

		// Save current thinking level
		savedThinkingLevel = pi.getThinkingLevel();

		planModeEnabled = true;
		executionMode = false;
		planApproved = false;
		todoItems = [];

		pi.setActiveTools(PLAN_MODE_TOOLS);
		pi.setThinkingLevel(planThinkingLevel);

		ctx.ui.notify(
			`Plan mode enabled (thinking: ${planThinkingLevel}). Tools: ${PLAN_MODE_TOOLS.join(", ")}`,
		);
		updateStatus(ctx);
		persistState();
	}

	function disablePlanMode(ctx: ExtensionContext, reason?: string): void {
		if (!planModeEnabled) return;

		planModeEnabled = false;
		executionMode = false;
		planApproved = false;
		todoItems = [];

		// Restore original thinking level
		if (savedThinkingLevel) {
			pi.setThinkingLevel(savedThinkingLevel);
			savedThinkingLevel = null;
		}

		pi.setActiveTools(NORMAL_MODE_TOOLS);

		const msg = reason ? `Plan mode disabled (${reason}).` : "Plan mode disabled. Full access restored.";
		ctx.ui.notify(msg);
		updateStatus(ctx);
		persistState();
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			disablePlanMode(ctx, "toggled");
		} else {
			enablePlanMode(ctx);
		}
	}

	// ── Plan approval workflow ───────────────────────────────────────────────

	async function approvePlan(ctx: ExtensionContext): Promise<void> {
		if (!planModeEnabled && !planApproved) {
			ctx.ui.notify("No pending plan to approve. Use /plan first.", "info");
			return;
		}

		planApproved = true;
		planModeEnabled = false;
		executionMode = todoItems.length > 0;

		// Restore original thinking level
		if (savedThinkingLevel) {
			pi.setThinkingLevel(savedThinkingLevel);
			savedThinkingLevel = null;
		}

		pi.setActiveTools(NORMAL_MODE_TOOLS);
		updateStatus(ctx);
		persistState();

		const execMessage =
			todoItems.length > 0
				? `Execute the approved plan. Start with step 1: ${todoItems[0].text}`
				: "Execute the plan you just created. Proceed step by step.";

		await pi.sendMessage(
			{ customType: "plan-mode-execute", content: execMessage, display: true },
			{ triggerTurn: true },
		);
	}

	async function denyPlan(ctx: ExtensionContext): Promise<void> {
		if (!planModeEnabled && !planApproved) {
			ctx.ui.notify("No pending plan to deny.", "info");
			return;
		}

		// Stay in plan mode — just prompt for refinement
		planApproved = false;
		persistState();

		const refinement = await ctx.ui.editor("What should be changed about the plan?", "");
		if (refinement?.trim()) {
			pi.sendUserMessage(
				`Please refine the plan based on this feedback: ${refinement.trim()}`,
			);
		} else {
			ctx.ui.notify("Denied. You can provide feedback or /plan to ask for a different approach.", "info");
		}
	}

	// ── Thinking level configuration ─────────────────────────────────────────

	async function setPlanThinkingLevel(ctx: ExtensionContext, level?: string): Promise<void> {
		if (!level) {
			ctx.ui.notify(
				`Plan-mode thinking level: ${planThinkingLevel}. Use "/plan-thinking <level>" to change.\n` +
					`Valid levels: off, minimal, low, medium, high, xhigh`,
				"info",
			);
			return;
		}

		if (!isValidThinkingLevel(level)) {
			ctx.ui.notify(
				`Invalid thinking level "${level}". Valid: off, minimal, low, medium, high, xhigh`,
				"error",
			);
			return;
		}

		planThinkingLevel = level;
		if (planModeEnabled) {
			pi.setThinkingLevel(planThinkingLevel);
		}
		ctx.ui.notify(`Plan-mode thinking level set to "${level}".`, "info");
		persistState();
	}

	// ── Persistence ──────────────────────────────────────────────────────────

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			planThinkingLevel,
			planApproved,
		});
	}

	// ── Commands ─────────────────────────────────────────────────────────────

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("approve", {
		description: "Approve the current plan and start execution",
		handler: async (_args, ctx) => approvePlan(ctx),
	});

	pi.registerCommand("deny", {
		description: "Deny the current plan and provide refinement feedback",
		handler: async (_args, ctx) => denyPlan(ctx),
	});

	pi.registerCommand("plan-thinking", {
		description: "Set or show the thinking level used in plan mode",
		handler: async (args, ctx) => setPlanThinkingLevel(ctx, args?.trim()),
	});

	// ── Shortcut ─────────────────────────────────────────────────────────────

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// ── Block destructive bash commands in plan mode ─────────────────────────

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason:
					`Plan mode: command blocked (not allowlisted). Use /approve or /deny first.\n` +
					`Blocked command: ${command}`,
			};
		}
	});

	// ── Filter stale plan mode context when not in plan mode ─────────────────

	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.customType === "plan-approve-prompt") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// ── Inject plan mode context before agent starts ─────────────────────────

	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE — Thinking: ${planThinkingLevel.toUpperCase()}]
You are in **plan mode** — a read-only exploration mode for code analysis and planning.

## Rules
- **NO EDITS OR WRITES.** You CANNOT use: edit, write. File modifications are disabled.
- You CAN use: read, bash, grep, find, ls.
- Bash is restricted to read-only commands (cat, grep, find, git status/log, etc.).
- **Investigate deeply:** Read full files (no offset/limit), grep for related patterns, explore the codebase.
- **Use web research:** Use curl or the agent-browser skill to look up documentation, APIs, best practices.
- **Ask clarifying questions** if requirements are ambiguous. Do not assume.

## Output
Create a detailed, structured plan. Use a "Plan:" header with numbered steps:

Plan:
1. First step — what to do, why, which files
2. Second step — what to do, why, which files
...

For each step, include:
- What will be changed and why
- Which files are affected
- Risks or edge cases to consider

## Final Step
After you've emitted the plan, tell the user:
**"Use /approve to execute this plan, or /deny to refine it."**`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING APPROVED PLAN — Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// ── Track [DONE:n] markers each turn ─────────────────────────────────────

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// ── Post-agent: extract plan, prompt for approval ────────────────────────

	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				// Restore thinking level after execution completes
				if (savedThinkingLevel) {
					pi.setThinkingLevel(savedThinkingLevel);
					savedThinkingLevel = null;
				}
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
				persistState();
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		// Prompt for approval
		planApproved = false; // Reset until user explicitly approves
		persistState();

		pi.sendMessage(
			{
				customType: "plan-approve-prompt",
				content:
					`---\n` +
					`**Plan ready for review.**\n\n` +
					`- Type **/approve** to execute this plan (enables all tools, restores thinking level)\n` +
					`- Type **/deny** to reject and provide refinement feedback\n` +
					`- Or continue the conversation to refine the plan manually`,
				display: true,
			},
			{ triggerTurn: false },
		);
	});

	// ── Session restore ──────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Load plan thinking level from settings (project overrides global, then default)
		planThinkingLevel = loadPlanThinkingLevel(ctx.cwd);

		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			planThinkingLevel = planModeEntry.data.planThinkingLevel ?? planThinkingLevel;
			planApproved = planModeEntry.data.planApproved ?? false;
		}

		// On resume: re-scan messages to rebuild completion state
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			savedThinkingLevel = pi.getThinkingLevel();
			pi.setActiveTools(PLAN_MODE_TOOLS);
			pi.setThinkingLevel(planThinkingLevel);
		}
		updateStatus(ctx);
	});
}
