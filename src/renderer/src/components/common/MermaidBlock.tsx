import { useEffect, useId, useState } from 'react';
import { CodeIcon, MaximizeIcon, WorkflowIcon } from 'lucide-react';
import { toast } from 'sonner';
import { call } from '@/lib/api';
import { useApp } from '@/store/app';
import { resolvedTheme } from '@/lib/theme';

// mermaid is large: load it the first time a diagram shows up, not at startup.
let loader: Promise<typeof import('mermaid').default> | null = null;
const loadMermaid = () => (loader ??= import('mermaid').then((m) => m.default));

const themeOf = (): 'dark' | 'light' => (resolvedTheme() === 'dark' ? 'dark' : 'light');

/** The app's own palette, so a diagram looks like part of the page in either theme. */
function themeVariables(theme: 'dark' | 'light') {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const text = color('--foreground', theme === 'dark' ? '#faf9f5' : '#141413');
  const line = color('--muted-foreground', '#8a8984');
  const node = color('--card', theme === 'dark' ? '#30302e' : '#ffffff');
  const group = color('--secondary', theme === 'dark' ? '#3a3a37' : '#f0eee6');
  const page = color('--code-bg', color('--background', theme === 'dark' ? '#1f1e1d' : '#f5f4ef'));
  const accent = color('--primary', '#d97757');
  return {
    darkMode: theme === 'dark',
    background: page,
    fontFamily: color('--font-sans', 'sans-serif'),
    textColor: text,
    primaryColor: node,
    primaryTextColor: text,
    primaryBorderColor: line,
    secondaryColor: group,
    secondaryTextColor: text,
    secondaryBorderColor: line,
    tertiaryColor: page,
    tertiaryTextColor: text,
    tertiaryBorderColor: line,
    lineColor: line,
    mainBkg: node,
    nodeBorder: line,
    nodeTextColor: text,
    clusterBkg: group,
    clusterBorder: line,
    titleColor: text,
    edgeLabelBackground: page,
    noteBkgColor: group,
    noteTextColor: text,
    noteBorderColor: line,
    actorBkg: node,
    actorBorder: line,
    actorTextColor: text,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: text,
    labelBoxBkgColor: group,
    labelBoxBorderColor: line,
    labelTextColor: text,
    loopTextColor: text,
    activationBkgColor: group,
    sequenceNumberColor: color('--primary-foreground', '#ffffff'),
    cScale0: accent,
  };
}

/**
 * Models like to hand-colour nodes with pastel `style`/`classDef` fills that were
 * picked for a white page and become unreadable on the app's palette. Those
 * colour directives are dropped so every diagram follows the theme.
 */
function themed(code: string) {
  let out = code.replace(/^\s*%%\{\s*init[\s\S]*?\}%%\s*$/gim, '');
  if (/^\s*(?:graph|flowchart|stateDiagram)/m.test(out)) {
    out = out
      .split('\n')
      .filter((line) => !/^\s*(?:style|classDef|linkStyle|class)\s/.test(line))
      .join('\n')
      .replace(/:::[\w-]+/g, '');
  }
  return out;
}

/** Re-render when the app switches between light and dark. */
function useThemeName() {
  const [theme, setTheme] = useState(themeOf);
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(themeOf()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, []);
  return theme;
}

/**
 * Renders a ```mermaid fence as a diagram. While the text is still streaming (or is
 * simply invalid) there is nothing to draw, so `fallback` shows the source instead.
 */
const chip = 'flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground hover:text-foreground';

export function MermaidBlock({ code, fallback }: { code: string; fallback: (extra?: React.ReactNode) => React.ReactNode }) {
  const id = `mermaid-${useId().replace(/\W/g, '')}`;
  const theme = useThemeName();
  const byDefault = useApp((s) => s.settings.renderMermaid !== false);
  const [manual, setManual] = useState(false);
  const enabled = byDefault || manual;
  const [source, setSource] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A short pause keeps a streaming diagram from being re-parsed on every token.
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables(theme), flowchart: { htmlLabels: true } });
        const out = await mermaid.render(id, themed(code));
        if (live) setSvg(out.svg);
      } catch {
        // Mermaid leaves its error graphic in the page when a render fails.
        document.getElementById(`d${id}`)?.remove();
        if (live) setSvg(null);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code, theme, id, enabled]);

  const showDiagram = (
    <button onClick={() => (enabled ? setSource(false) : setManual(true))} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
      <WorkflowIcon className="size-3" />
      {enabled ? '查看图表' : '渲染为图表'}
    </button>
  );
  if (!enabled || (svg && source)) return <>{fallback(showDiagram)}</>;
  if (!svg) return <>{fallback()}</>;
  return (
    <>
      {/* A fixed-height frame: the diagram scales to fit it however wide the window is. */}
      <div className="group relative my-2 h-80 overflow-hidden rounded-lg border bg-code p-3">
        <div className="h-full w-full [&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-none!" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          <button onClick={() => setSource(true)} title="查看源代码" className={chip}>
            <CodeIcon className="size-3" />
            源代码
          </button>
          <button onClick={() => call('diagram:open', svg).catch(() => toast.error('无法打开图表窗口'))} title="在新窗口查看全图" className={chip}>
            <MaximizeIcon className="size-3" />
            查看全图
          </button>
        </div>
      </div>
    </>
  );
}
