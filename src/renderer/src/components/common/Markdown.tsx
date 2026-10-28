import { t as tr, useT } from '@/lib/i18n';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { call } from '@/lib/api';
import { highlight, langOfFence } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { openFileRef } from '@/store/actions';
import { MermaidBlock } from './MermaidBlock';

// Paths may contain non-ASCII names (e.g. 收件箱整理.md:1).
const FILE_REF = /((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+\.(?:[a-z]{1,5})):(\d+)/gu;
const FILE_SCHEME = 'pi-file:';

/** remark plugin: `path/to/file.ts:12` becomes a link that opens the file at that line. */
function remarkFileRefs() {
  const visit = (node: any) => {
    if (!node.children || node.type === 'link' || node.type === 'code') return;
    const out: any[] = [];
    for (const child of node.children) {
      if (child.type === 'inlineCode') {
        FILE_REF.lastIndex = 0;
        const m = FILE_REF.exec(child.value);
        if (m && m[0] === child.value) out.push({ type: 'link', url: `${FILE_SCHEME}${m[1]}:${m[2]}`, children: [child] });
        else out.push(child);
        continue;
      }
      if (child.type !== 'text') {
        visit(child);
        out.push(child);
        continue;
      }
      let last = 0;
      FILE_REF.lastIndex = 0;
      for (const m of child.value.matchAll(FILE_REF)) {
        if (m.index! > last) out.push({ type: 'text', value: child.value.slice(last, m.index) });
        out.push({ type: 'link', url: `${FILE_SCHEME}${m[1]}:${m[2]}`, children: [{ type: 'text', value: m[0] }] });
        last = m.index! + m[0].length;
      }
      if (last === 0) out.push(child);
      else if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) });
    }
    node.children = out;
  };
  return (tree: any) => visit(tree);
}

/** `flush`: for a code block that is already inside a bordered panel (tool output): it draws only the separator above itself. */
export function CodeBlock({ lang, code, extra, flush }: { lang: string; code: string; extra?: ReactNode; flush?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className={cn('bg-code', flush ? 'border-t first:border-t-0' : 'my-2 overflow-hidden rounded-lg border')}>
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{lang || 'text'}</span>
        <div className="flex items-center gap-1">
          {extra}
          <button onClick={copy} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {t(copied ? 'md.copied' : 'md.copy')}
          </button>
        </div>
      </div>
      <pre className={cn('overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed', flush && 'max-h-80 overflow-y-auto')}>
        <code dangerouslySetInnerHTML={{ __html: highlight(code, langOfFence(lang)) }} />
      </pre>
    </div>
  );
}

const components: Components = {
  a({ href, children }) {
    if (href?.startsWith(FILE_SCHEME)) {
      const ref = href.slice(FILE_SCHEME.length);
      const at = ref.lastIndexOf(':');
      return (
        <button type="button" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" onClick={() => void openFileRef(ref.slice(0, at), Number(ref.slice(at + 1)))}>
          {children}
        </button>
      );
    }
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href && /^https?:\/\//i.test(href)) call('app:openExternal', href).catch(() => toast.error(tr('md.openLinkFailed')));
        }}
      >
        {children}
      </a>
    );
  },
  pre({ children }) {
    const code = (children as any)?.props;
    const lang = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1] ?? '';
    const text = String(code?.children ?? '').replace(/\n$/, '');
    if (lang !== 'mermaid') return <CodeBlock lang={lang} code={text} />;
    return <MermaidBlock code={text} fallback={(extra) => <CodeBlock lang={lang} code={text} extra={extra} />} />;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

const urlTransform = (url: string) => (url.startsWith(FILE_SCHEME) ? url : defaultUrlTransform(url));

export const Markdown = memo(function Markdown({ text, className, children }: { text: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('prose-chat', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFileRefs]} components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
      {children}
    </div>
  );
});
