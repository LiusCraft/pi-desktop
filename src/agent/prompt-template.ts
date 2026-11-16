// pi expands `/name args` into the template text itself and leaves no trace of it, so a command would read
// as a wall of text in the transcript. Expanding it here lets the message carry a marker (see command-message.ts).
// The rules are pi's own (prompt-templates.ts in @earendil-works/pi-coding-agent), which does not export them.
import type { PromptTemplate } from '@earendil-works/pi-coding-agent';

function parseArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/** $1.., $@ / $ARGUMENTS, ${N:-default}, ${@:N} and ${@:N:L}. */
function substitute(content: string, args: string[]): string {
  const all = args.join(' ');
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_m, target, fallback, from, length, simple) => {
      if (target) {
        const value = target === '@' || target === 'ARGUMENTS' ? all : args[parseInt(target, 10) - 1];
        return value || fallback;
      }
      if (from) {
        const start = Math.max(parseInt(from, 10) - 1, 0);
        return args.slice(start, length ? start + parseInt(length, 10) : undefined).join(' ');
      }
      if (simple === 'ARGUMENTS' || simple === '@') return all;
      return args[parseInt(simple, 10) - 1] ?? '';
    },
  );
}

/** The template a message such as `/review src/a.ts` calls, with its arguments filled in; null when it calls none. */
export function expandUserCommand(
  message: string,
  templates: ReadonlyArray<PromptTemplate>,
): { name: string; args: string; prompt: string } | null {
  const m = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(message);
  const template = m && templates.find((t) => t.name === m[1]);
  if (!m || !template) return null;
  const args = m[2] ?? '';
  return { name: template.name, args, prompt: substitute(template.content, parseArgs(args)) };
}
