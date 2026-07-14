import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── Auth.json resolution ─────────────────────────────────────
function resolveAuthJsonValue(key: string): string | undefined {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = readFileSync(authPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const value = data[key];

    if (typeof value === "string") {
      if (value.startsWith("!")) {
        return execSync(value.slice(1), { encoding: "utf-8", timeout: 30000 }).trim();
      }
      return value;
    }

    if (
      value &&
      typeof value === "object" &&
      (value as any).type === "api_key" &&
      typeof (value as any).key === "string"
    ) {
      const k = (value as any).key as string;
      if (k.startsWith("!")) {
        return execSync(k.slice(1), { encoding: "utf-8", timeout: 30000 }).trim();
      }
      return k;
    }
  } catch {
    // ignore missing or malformed auth.json
  }
  return undefined;
}

// ── Configuration ──────────────────────────────────────────────
const VIKUNJA_URL = (process.env.VIKUNJA_URL || "http://localhost:3456/api/v1").replace(/\/$/, "");
const VIKUNJA_TOKEN =
  process.env.VIKUNJA_TOKEN ||
  resolveAuthJsonValue("VIKUNJA_TOKEN") ||
  resolveAuthJsonValue("vikunja") ||
  "";

// ── Types ──────────────────────────────────────────────────────
interface VikunjaProject {
  id: number;
  title: string;
  description: string;
  identifier: string;
}

interface VikunjaTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  due_date: string | null;
  priority: number;
  project_id: number;
  created: string;
  updated: string;
}

// ── Helpers ────────────────────────────────────────────────────
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (VIKUNJA_TOKEN) headers["Authorization"] = `Bearer ${VIKUNJA_TOKEN}`;
  return headers;
}

async function vikunjaFetch(
  path: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<unknown> {
  const url = `${VIKUNJA_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers as Record<string, string> || {}) },
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vikunja API error ${response.status}: ${text}`);
  }
  return response.json();
}

function assertConfigured() {
  if (!VIKUNJA_URL) throw new Error("VIKUNJA_URL is not configured.");
  if (!VIKUNJA_TOKEN) {
    throw new Error(
      "VIKUNJA_TOKEN is not configured. Set the environment variable before using Vikunja tools."
    );
  }
}

function formatTask(t: VikunjaTask): string {
  const status = t.done ? "[x]" : "[ ]";
  const due = t.due_date ? ` (due: ${t.due_date.split("T")[0]})` : "";
  const prio = t.priority > 0 ? ` (!${t.priority})` : "";
  return `${status} #${t.id}${prio}: ${t.title}${due}`;
}

// ── Extension ──────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  // ── Tool: List Projects ────────────────────────────────────
  pi.registerTool({
    name: "vikunja_list_projects",
    label: "Vikunja List Projects",
    description: "List available Vikunja projects so the user can choose a project_id.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      assertConfigured();
      const data = await vikunjaFetch("/projects", {}, signal);
      const projects: VikunjaProject[] = Array.isArray(data) ? data : ((data as any).projects || []);
      const lines = projects.map(
        (p) => `${p.id}: ${p.title}${p.identifier ? ` (${p.identifier})` : ""}`
      );
      const text = lines.length ? lines.join("\n") : "No projects found.";
      return { content: [{ type: "text", text }], details: { projects, count: projects.length } };
    },
  });

  // ── Tool: List Tasks ─────────────────────────────────────────
  pi.registerTool({
    name: "vikunja_list_tasks",
    label: "Vikunja List Tasks",
    description: "List tasks from Vikunja. Optionally filter by project ID, done status, or search query.",
    promptSnippet: "List or search Vikunja tasks and todos",
    promptGuidelines: [
      "Use vikunja_list_tasks when the user asks to see their todos, tasks, or task list.",
      "Use vikunja_list_tasks with done=false to show only open tasks.",
      "If the user mentions a project name but you only know the ID, filter by project_id.",
      "If you need to find the project ID first, use vikunja_list_projects.",
    ],
    parameters: Type.Object({
      project_id: Type.Optional(Type.Number({ description: "Filter by project ID" })),
      done: Type.Optional(Type.Boolean({ description: "Filter to done (true) or open (false) tasks" })),
      search: Type.Optional(Type.String({ description: "Search query for title/description" })),
      limit: Type.Optional(Type.Number({ description: "Maximum tasks to return (default 50)" })),
    }),
    async execute(_toolCallId, params, signal) {
      assertConfigured();
      const query = new URLSearchParams();
      query.append("per_page", String(params.limit ?? 50));
      if (params.project_id !== undefined) query.append("project_id", String(params.project_id));
      if (params.search) query.append("s", params.search);

      const data = await vikunjaFetch(`/tasks?${query.toString()}`, {}, signal);
      let tasks: VikunjaTask[] = Array.isArray(data) ? data : ((data as any).tasks || []);
      if (params.done !== undefined) tasks = tasks.filter((t) => t.done === params.done);

      const lines = tasks.map(formatTask);
      const text = lines.length ? lines.join("\n") : "No tasks found.";
      return { content: [{ type: "text", text }], details: { tasks, count: tasks.length } };
    },
  });

  // ── Tool: Create Task ──────────────────────────────────────
  pi.registerTool({
    name: "vikunja_create_task",
    label: "Vikunja Create Task",
    description: "Create a new task in Vikunja.",
    promptSnippet: "Create a new Vikunja task or todo",
    promptGuidelines: [
      "Use vikunja_create_task when the user asks to add, create, or schedule a task or todo.",
      "Extract the title and description from the user's request.",
      "If the user mentions a project name, first call vikunja_list_projects to find the project_id, then create the task.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Task title" }),
      description: Type.Optional(Type.String({ description: "Task description" })),
      project_id: Type.Optional(
        Type.Number({ description: "Project ID to assign the task to. Omit to use the default project." })
      ),
      due_date: Type.Optional(
        Type.String({
          description: "Due date in ISO 8601 format (e.g., 2025-07-15) or datetime (2025-07-15T10:00:00Z)",
        })
      ),
      priority: Type.Optional(
        Type.Number({ description: "Priority level (0-5, where higher is more urgent)" })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      assertConfigured();
      const body: Record<string, unknown> = { title: params.title };
      if (params.description !== undefined) body.description = params.description;
      if (params.project_id !== undefined) body.project_id = params.project_id;
      // Default to project 1 (Inbox) if not provided, matching Vikunja API expectations
      if (body.project_id === undefined) body.project_id = 1;
      if (params.due_date !== undefined) body.due_date = params.due_date;
      if (params.priority !== undefined) body.priority = params.priority;

      const projectId = Number(body.project_id ?? 1);
      const task = (await vikunjaFetch(`/projects/${projectId}/tasks`, { method: "PUT", body: JSON.stringify(body) }, signal)) as VikunjaTask;
      return {
        content: [{ type: "text", text: `Created task #${task.id}: ${task.title}` }],
        details: { task },
      };
    },
  });

  // ── Tool: Update Task ──────────────────────────────────────
  pi.registerTool({
    name: "vikunja_update_task",
    label: "Vikunja Update Task",
    description: "Update an existing Vikunja task. You must know the task ID.",
    promptSnippet: "Update, mark complete, or edit a Vikunja task",
    promptGuidelines: [
      "Use vikunja_update_task when the user asks to mark a task done, edit its title/description, change due date, or set priority.",
      "You must know the task ID. Use vikunja_list_tasks first if the user did not provide an ID.",
    ],
    parameters: Type.Object({
      task_id: Type.Number({ description: "ID of the task to update" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      done: Type.Optional(Type.Boolean({ description: "Mark as done or reopen" })),
      due_date: Type.Optional(Type.String({ description: "New due date in ISO 8601 format" })),
      priority: Type.Optional(Type.Number({ description: "New priority (0-5)" })),
    }),
    async execute(_toolCallId, params, signal) {
      assertConfigured();
      // Fetch current state first to safely merge partial updates
      const current = (await vikunjaFetch(`/tasks/${params.task_id}`, {}, signal)) as VikunjaTask;
      const body: Record<string, unknown> = { ...current };

      if (params.title !== undefined) body.title = params.title;
      if (params.description !== undefined) body.description = params.description;
      if (params.done !== undefined) body.done = params.done;
      if (params.due_date !== undefined) body.due_date = params.due_date;
      if (params.priority !== undefined) body.priority = params.priority;

      const task = (await vikunjaFetch(`/tasks/${params.task_id}`, { method: "POST", body: JSON.stringify(body) }, signal)) as VikunjaTask;
      return {
        content: [{ type: "text", text: `Updated task #${task.id}: ${task.title}` }],
        details: { task },
      };
    },
  });

  // ── Command: /vikunja-todos ─────────────────────────────────
  pi.registerCommand("vikunja-todos", {
    description: "List open Vikunja tasks",
    handler: async (args, ctx) => {
      if (!VIKUNJA_TOKEN) {
        ctx.ui.notify("VIKUNJA_TOKEN not set", "error");
        return;
      }
      try {
        const data = await vikunjaFetch("/tasks?per_page=20");
        let tasks: VikunjaTask[] = Array.isArray(data) ? data : ((data as any).tasks || []);
        tasks = tasks.filter((t) => !t.done);
        if (args) tasks = tasks.filter((t) => t.title.toLowerCase().includes(args.toLowerCase()));
        const text = tasks.map(formatTask).join("\n") || "No open tasks.";
        ctx.ui.notify(`${tasks.length} open Vikunja tasks`, "info");
        ctx.ui.setWidget("vikunja-todos", text.split("\n").slice(0, 10));
      } catch (err: any) {
        ctx.ui.notify(`Vikunja error: ${err.message}`, "error");
      }
    },
  });

  // ── Command: /vikunja-config ───────────────────────────────
  pi.registerCommand("vikunja-config", {
    description: "Show Vikunja extension configuration",
    handler: async (_args, ctx) => {
      const maskedToken = VIKUNJA_TOKEN
        ? `${VIKUNJA_TOKEN.slice(0, 4)}...${VIKUNJA_TOKEN.slice(-4)}`
        : "(not set)";
      ctx.ui.notify(`URL: ${VIKUNJA_URL || "(not set)"} | Token: ${maskedToken}`, "info");
    },
  });
}
