// Syntax highlighting with a small highlight.js core: the languages agents touch most.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS = { bash, cpp, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);

const EXT: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', css: 'css', scss: 'css', md: 'markdown', py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash', go: 'go', rs: 'rust',
  java: 'java', c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', sql: 'sql', yml: 'yaml', yaml: 'yaml', html: 'xml', htm: 'xml',
  xml: 'xml', svg: 'xml', vue: 'xml', diff: 'diff', patch: 'diff',
};

export const langOfPath = (p: string) => EXT[String(p).split('.').pop()?.toLowerCase() ?? ''] ?? '';
export const langOfFence = (lang: string) => (hljs.getLanguage(lang) ? lang : (EXT[lang] ?? ''));

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Highlighted HTML for one snippet; unknown languages are just escaped. */
export function highlight(code: string, lang: string) {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
