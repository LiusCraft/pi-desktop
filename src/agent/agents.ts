/**
 * Subagent identities for the `pidesk_task` tool: the built-in ones below plus any
 * `<app data>/agents/*.md` the user adds (Settings → 子代理 edits those files). An
 * identity is a system-prompt addendum, an optional model and an optional tool
 * allowlist; every subagent still runs in plan mode, so configuration can never widen
 * what it is allowed to change.
 *
 * ```md
 * ---
 * name: reviewer                         # defaults to the file name
 * description: Reviews a diff for bugs   # shown to the model; required
 * model: anthropic/claude-sonnet-5-5     # optional; defaults to the parent's model
 * tools: ["read", "grep", "find", "ls"]  # optional allowlist; omit to keep MCP tools
 * ---
 * You are a meticulous code reviewer…
 * ```
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import type { AgentCatalog, AgentConfig, AgentDraft } from '@shared/protocol';

export interface AgentType {
  name: string;
  /** Shown to the model so it can pick the right one. */
  description: string;
  /** The role instructions; `agentPrompt` adds the shared preamble. */
  body: string;
  /** `provider/id`; the parent's model when absent or unknown. */
  model?: string;
  /** Tool allowlist; the default read-only set (plus MCP) when absent. */
  tools?: string[];
  source: 'builtin' | 'user';
  /** The user file this came from. */
  file?: string;
}

const SHARED = `You are a subagent started by another agent. You cannot ask the user questions and you cannot change anything: you only read, search and report. Your final message is the only thing the caller sees, so make it complete and self-contained.`;

/** What gets appended to a subagent's system prompt. */
export const agentPrompt = (agent: AgentType) => `${SHARED}\n\n${agent.body}`;

export const AGENT_TYPES: AgentType[] = [
  {
    name: 'explore',
    description: 'Fast read-only research: find files, trace code paths, answer questions about the codebase, search the web when a search tool is available.',
    body: '# Role: Explore\nSearch widely and quickly, then report what you found. Cite file paths with line numbers. Prefer several parallel searches over one careful one. Do not propose a design unless asked.',
    source: 'builtin',
  },
  {
    name: 'plan',
    description: 'Read-only software architect: study the code and return a step-by-step implementation plan with the files to change and the trade-offs.',
    body: '# Role: Plan\nExplore only as much as you need, then return an implementation plan: context, an ordered list of changes naming the files and functions involved, risks and trade-offs, and how to verify the result. Recommend one approach instead of listing every option.',
    source: 'builtin',
  },
];

export const DEFAULT_AGENT = 'explore';

const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const clean = (list: unknown): string[] | undefined => {
  const items = (Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : []).map((t) => String(t).trim()).filter(Boolean);
  return items.length ? items : undefined;
};

/** Built-in identities plus the user's files; a user file replaces a built-in of the same name. */
export function loadAgents(dir: string | undefined): AgentType[] {
  const found = new Map(AGENT_TYPES.map((a) => [a.name, a]));
  let files: string[] = [];
  try {
    files = dir ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort() : [];
  } catch {
    // No agents folder yet.
  }
  for (const file of files) {
    try {
      const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(fs.readFileSync(path.join(dir!, file), 'utf8'));
      const name = String(fm.name ?? path.basename(file, path.extname(file))).trim();
      const description = String(fm.description ?? '').trim();
      if (!NAME.test(name) || !description || !body.trim()) continue;
      found.set(name, {
        name, description, body: body.trim(), source: 'user', file: path.join(dir!, file),
        model: typeof fm.model === 'string' && fm.model.trim() ? fm.model.trim() : undefined,
        tools: clean(fm.tools),
      });
    } catch {
      // An unreadable or malformed file is skipped; the rest still load.
    }
  }
  return [...found.values()];
}

/** What the settings page shows: every identity, and which built-ins a user file overrides. */
export function agentCatalog(dir: string): AgentCatalog {
  const builtin = new Set(AGENT_TYPES.map((a) => a.name));
  const agents: AgentConfig[] = loadAgents(dir).map((a) => ({
    name: a.name, description: a.description, body: a.body, model: a.model, tools: a.tools, source: a.source,
    overrides: a.source === 'user' && builtin.has(a.name),
  }));
  return { agents, dir };
}

/** Quote a string for YAML frontmatter (JSON strings are valid YAML). */
const q = (s: string) => JSON.stringify(s);

/** Create or update a user agent file; renaming moves the file. */
export function saveAgent(dir: string, draft: AgentDraft): AgentCatalog {
  const name = draft.name.trim();
  const description = draft.description.trim().replace(/\s+/g, ' ');
  const body = draft.body.trim();
  if (!NAME.test(name)) throw new Error('名称只能包含字母、数字、- 和 _，且以字母或数字开头');
  if (!description) throw new Error('请填写描述：模型靠它判断什么时候用这个子代理');
  if (!body) throw new Error('请填写系统提示');
  const existing = loadAgents(dir);
  const original = draft.originalName && draft.originalName !== name ? existing.find((a) => a.name === draft.originalName) : undefined;
  if (existing.some((a) => a.name === name && a.source === 'user' && name !== draft.originalName)) throw new Error(`已经有名为 ${name} 的子代理`);
  fs.mkdirSync(dir, { recursive: true });
  const same = existing.find((a) => a.name === name && a.file);
  const file = same?.file ?? path.join(dir, `${name}.md`);
  const tools = clean(draft.tools);
  const head = [
    '---',
    `name: ${q(name)}`,
    `description: ${q(description)}`,
    draft.model ? `model: ${q(draft.model)}` : '',
    tools ? `tools: ${JSON.stringify(tools)}` : '',
    '---',
  ].filter(Boolean);
  fs.writeFileSync(file, `${head.join('\n')}\n${body}\n`, 'utf8');
  if (original?.file && original.file !== file) fs.rmSync(original.file, { force: true });
  return agentCatalog(dir);
}

/** Delete a user agent's file; a built-in of that name comes back. */
export function removeAgent(dir: string, name: string): AgentCatalog {
  const agent = loadAgents(dir).find((a) => a.name === name);
  if (!agent?.file) throw new Error(`${name} 是内置子代理，没有可删除的自定义文件`);
  fs.rmSync(agent.file, { force: true });
  return agentCatalog(dir);
}
