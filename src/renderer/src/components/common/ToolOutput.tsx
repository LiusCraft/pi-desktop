// A tool's text output in the transcript: JSON is laid out as data, ```fenced parts become real
// code blocks (highlight, language, copy, sideways scroll), everything else stays monospace text.
import { memo, useMemo, useState } from 'react';
import { langOfFence } from '@/lib/highlight';
import { useT } from '@/lib/i18n';
import { parseJsonOutput, splitFences } from '@/lib/tool-output';
import { CopyGlyph, useCopy } from './Copy';
import { HighlightedCode } from './CodeView';
import { CodeBlock } from './Markdown';
import { Segmented } from './Segmented';
import { StructuredValue } from './StructuredData';

/** Every block draws the hairline above itself, so the panel never stacks two borders. */
const BLOCK = 'border-t first:border-t-0';

/** One JSON result: laid out as data, with the raw JSON and its exact text one toggle away. */
function JsonBlock({ text, value }: { text: string; value: object }) {
  const t = useT();
  const [raw, setRaw] = useState(false);
  const { copied, copy } = useCopy();
  const pretty = useMemo(() => JSON.stringify(value, null, 2) ?? text, [value, text]);
  const summary = Array.isArray(value) ? t('tool.items', { n: value.length }) : t('tool.fields', { n: Object.keys(value).length });
  return (
    <div className={BLOCK}>
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{summary}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Segmented
            compact
            value={raw ? 'raw' : 'data'}
            onChange={(id) => setRaw(id === 'raw')}
            options={[{ id: 'data', label: t('tool.structured') }, { id: 'raw', label: t('tool.raw') }]}
          />
          <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" onClick={() => copy(pretty)}>
            <CopyGlyph copied={copied} />
            {t(copied ? 'md.copied' : 'md.copy')}
          </button>
        </div>
      </div>
      {raw ? (
        <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"><HighlightedCode code={pretty} lang="json" /></pre>
      ) : (
        <div className="max-h-80 overflow-auto px-2 py-1.5">
          <StructuredValue value={value} />
        </div>
      )}
    </div>
  );
}

export const ToolOutput = memo(function ToolOutput({ text }: { text: string }) {
  const segments = useMemo(() => splitFences(text), [text]);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'code') {
          // A fence labelled json is data like any other, not something to read line by line.
          const json = langOfFence(segment.lang) === 'json' ? parseJsonOutput(segment.code) : null;
          return json
            ? <JsonBlock key={i} text={segment.code} value={json.value} />
            : <CodeBlock key={i} lang={segment.lang} code={segment.code} flush />;
        }
        const json = parseJsonOutput(segment.text);
        if (json) return <JsonBlock key={i} text={segment.text} value={json.value} />;
        return <pre key={i} className={`${BLOCK} max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap`}>{segment.text}</pre>;
      })}
    </>
  );
});
