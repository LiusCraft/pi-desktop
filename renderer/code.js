// Code mode, driven by real pi sessions over the Electron bridge.
(() => {
  const $ = (s) => document.querySelector(s);
  const { highlight, renderMarkdown, esc, toast, wireCode } = window.CC;
  const previews = window.ToolPreviews;
  const attachments = window.PiAttachments;
  const api = window.piDesktop;
  if (!api) {
    document.body.dataset.mode = 'chat';
    toast('Code 模式需要在 Pi Desktop 应用中运行');
    return;
  }
  const call = (ch, ...a) => api.invoke(ch, ...a);
  const app = $('#app');
  const codeMain = $('#codeMain');
  const msgsEl = $('#codeMsgs');
  const codeInput = $('#codeInput');
  const codeSend = $('#codeSend');
  const codeComposer = $('#codeComposer');
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const workspace = window.createWorkspace(codeMain, store);
  const fail = (err) => toast(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));

  /* ================= 图标 ================= */
  const I = {
    cv: '<svg class="cv" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5.5l4.5 4.5L8 14.5"/></svg>',
    cvd: '<svg class="cv" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5.5 8l4.5 4.5L14.5 8"/></svg>',
    pr: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>',
    merged: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"/></svg>',
    branch: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="15" r="2"/><circle cx="14" cy="7" r="2"/><path d="M6 7v6M14 9c0 3-4 3-8 4"/></svg>',
    laptop: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="4.5" width="13" height="8.5" rx="1.5"/><path d="M2 15.5h16"/></svg>',
    copy: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>',
    fork: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5.5" cy="4.5" r="1.8"/><circle cx="14.5" cy="4.5" r="1.8"/><circle cx="10" cy="15.5" r="1.8"/><path d="M5.5 6.3v1.2a2.5 2.5 0 0 0 2.5 2.5h4a2.5 2.5 0 0 0 2.5-2.5V6.3M10 10v3.7"/></svg>',
    code: '<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 6 3 10l4 4M13 6l4 4-4 4"/></svg>',
    gapUp: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5.5 12.5 10 8l4.5 4.5"/></svg>',
    gapBoth: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 7.5l4-3.5 4 3.5M6 12.5l4 3.5 4-3.5"/></svg>',
    close: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    expand: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11.5 3.5h5v5M16.5 3.5 11 9M8.5 16.5h-5v-5M3.5 16.5 9 11"/></svg>',
    back: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5l-5 5 5 5"/></svg>',
    comment: '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 16.5c3.9 0 7-2.7 7-6s-3.1-6-7-6-7 2.7-7 6c0 1.4.6 2.7 1.5 3.7L4 17l3-1.1c.9.4 1.9.6 3 .6z"/></svg>',
    reload: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.5h-3.5"/></svg>',
    check: '<svg class="ck" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
    folder: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 6a2 2 0 0 1 2-2h3.2l1.6 1.8h6.2a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 2.5h6l4 4v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/><path d="M11.5 2.5v4h4"/></svg>',
    warn: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3.5 2.8 16h14.4z"/><path d="M10 8.5v3.5M10 14.2v.01"/></svg>',
    plus: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4.5v11M4.5 10h11"/></svg>',
  };

  /* ================= Chat / Code 切换 ================= */
  function setMode(m) {
    document.body.dataset.mode = m;
    store.set('cc_mode', m);
    window.CC.closeMenus();
    const last = state.lastByMode[m];
    const rt = last && state.rts.get(last);
    if (rt && !rt.meta.archived) openSession(last);
    else showWelcome();
  }
  document.querySelectorAll('#modeSwitch button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  document.body.dataset.mode = store.get('cc_mode', 'code');

  /* ================= Diff 与代码展示 ================= */
  function lineDiff(a, b) {
    const A = a == null ? [] : a.split('\n');
    const B = b == null ? [] : b.split('\n');
    const n = A.length, m = B.length;
    // Large files: fall back to a whole-file replace instead of an O(n·m) table.
    if (n * m > 4e6) return [...A.map((s, i) => ({ t: '-', o: i + 1, s })), ...B.map((s, i) => ({ t: '+', n: i + 1, s }))];
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: ' ', o: i + 1, n: j + 1, s: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', o: i + 1, s: A[i] }); i++; }
      else { out.push({ t: '+', n: j + 1, s: B[j] }); j++; }
    }
    while (i < n) { out.push({ t: '-', o: i + 1, s: A[i] }); i++; }
    while (j < m) { out.push({ t: '+', n: j + 1, s: B[j] }); j++; }
    for (let k = 0; k < out.length;) {
      if (out[k].t !== '-') { k++; continue; }
      let d = k; while (d < out.length && out[d].t === '-') d++;
      let a2 = d; while (a2 < out.length && out[a2].t === '+') a2++;
      const dels = out.slice(k, d), adds = out.slice(d, a2);
      for (let x = 0; x < Math.min(dels.length, adds.length); x++) {
        const p = dels[x].s, q = adds[x].s;
        let pre = 0; while (pre < p.length && pre < q.length && p[pre] === q[pre]) pre++;
        let suf = 0; while (suf < p.length - pre && suf < q.length - pre && p[p.length - 1 - suf] === q[q.length - 1 - suf]) suf++;
        if (pre + suf > 0) { dels[x].wd = [pre, p.length - suf]; adds[x].wd = [pre, q.length - suf]; }
      }
      k = a2;
    }
    return out;
  }
  const LANG = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', json: 'json', css: 'css', md: 'md', py: 'py', sh: 'sh', go: 'js', rs: 'js', java: 'js', c: 'js', cpp: 'js', sql: 'sql', yml: 'yaml', yaml: 'yaml' };
  const langOf = (p) => LANG[String(p).split('.').pop()] || 'text';
  const diffStats = (a, b) => {
    const d = lineDiff(a, b);
    return { add: d.filter((r) => r.t === '+').length, del: d.filter((r) => r.t === '-').length };
  };
  function lineHTML(r, lang) {
    if (!r.wd) return highlight(r.s, lang) || ' ';
    const [x, y] = r.wd;
    return highlight(r.s.slice(0, x), lang) + `<span class="wd">${highlight(r.s.slice(x, y), lang)}</span>` + highlight(r.s.slice(y), lang);
  }
  const rowHTML = (r, lang) => {
    const cls = r.t === '+' ? 'add' : r.t === '-' ? 'del' : '';
    return `<div class="dr ${cls}"><span class="n">${r.t === '-' ? r.o : r.n}</span><span class="s">${r.t === ' ' ? '' : r.t}</span><span class="c">${lineHTML(r, lang)}</span></div>`;
  };
  function diffRows(a, b, path, openGaps = new Set(), ctx = 3) {
    const d = lineDiff(a, b), lang = langOf(path);
    const keep = d.map(() => false);
    d.forEach((r, k) => { if (r.t !== ' ') for (let x = Math.max(0, k - ctx); x <= Math.min(d.length - 1, k + ctx); x++) keep[x] = true; });
    let html = '';
    for (let k = 0; k < d.length;) {
      if (keep[k]) { html += rowHTML(d[k], lang); k++; continue; }
      let e = k; while (e < d.length && !keep[e]) e++;
      const id = `${path}:${k}`;
      if (openGaps.has(id)) { for (let x = k; x < e; x++) html += rowHTML(d[x], lang); }
      else html += `<div class="gap" data-gap="${esc(id)}">${k === 0 || e === d.length ? I.gapUp : I.gapBoth}${e - k} unmodified lines</div>`;
      k = e;
    }
    return html;
  }
  const smallDiff = (a, b, path) => `<div class="dv">${diffRows(a, b, path, new Set(), 2)}</div>`;
  function codeLines(src, path, hl, startLine = 1, limit = previews.PREVIEW_LINES, viewer = false) {
    const lines = Array.isArray(src) ? src : String(src).split('\n');
    return `<div class="mbox code-lines${viewer ? ' file-code' : ''}">${lines.slice(0, limit).map((l, i) => {
      const line = startLine + i;
      return `<div class="vl${hl === line ? ' target-line' : ''}" data-line="${line}"><span class="n">${line}</span><span>${highlight(l, langOf(path)) || ' '}</span></div>`;
    }).join('')}</div>`;
  }
  function toolPreviewHTML(p, path) {
    if (p.type === 'error' || p.type === 'notice') return `<pre class="mbox tool-notice${p.type === 'error' ? ' tool-error' : ''}">${esc(p.text || 'No preview available')}</pre>`;
    if (p.type === 'image') return `<div class="tool-image">${p.images.map((image) => `<img src="${esc(image.src)}" alt="${esc(fname(path))}" title="${esc(path)}" loading="lazy">`).join('')}<div class="tool-preview-note">${esc(p.text || 'Image preview unavailable')}</div></div>`;
    if (p.type === 'diff') {
      const rows = p.rows.slice(0, previews.PREVIEW_LINES);
      return `<div class="dv tool-diff">${rows.map((r) => r.gap ? '<div class="tool-preview-gap">… unchanged lines …</div>' : rowHTML(r, langOf(path))).join('')}</div>${p.rows.length > rows.length ? '<div class="tool-preview-note">Preview limited to 200 rows. Open the file to see current content.</div>' : ''}`;
    }
    const count = p.empty ? 0 : p.lines.length;
    const shown = Math.min(count, previews.PREVIEW_LINES);
    const range = count ? `Lines ${p.startLine}–${p.startLine + shown - 1}${p.totalLines ? ` of ${p.totalLines}` : ''}` : 'Empty file';
    return `<div class="tool-preview-meta">${esc(p.note || range)}${p.note ? ` · ${range}` : ''}</div>${p.empty ? '' : codeLines(p.lines, path, null, p.startLine)}${count > shown ? `<div class="tool-preview-note">${count - shown} more lines in this result. Open the file to see current content.</div>` : ''}${p.footer ? `<div class="tool-preview-note tool-continuation">${esc(p.footer)}</div>` : ''}`;
  }
  const colorOut = (out) => esc(out).split('\n').map((l) =>
    /✓|✔|passed|built in|\[new branch\]/.test(l) && !/failed|✖/.test(l) ? `<span class="ok">${l}</span>` :
    /✗|✖|FAIL|failed|Error|exited with code [1-9]/.test(l) ? `<span class="err">${l}</span>` :
    /^&gt;|RUN|Duration|^ℹ/.test(l) ? `<span class="dim">${l}</span>` : l).join('\n');
  const termBox = (cmd, out) => `<pre class="mbox"><span class="cmd">${esc(cmd)}</span>\n${colorOut(out)}</pre>`;
  const contentText = (c) => (typeof c === 'string' ? c : (c || []).filter((x) => x.type === 'text').map((x) => x.text).join(''));

  /* ================= 状态 ================= */
  const MODES = [
    { id: 'auto', name: 'Auto', desc: '自动执行安全操作；推送、发 PR、删除等有风险的命令才询问' },
    { id: 'default', name: 'Ask permissions', desc: '编辑文件和运行命令前都先征求同意' },
    { id: 'acceptEdits', name: 'Accept edits', desc: '直接修改项目内文件，运行命令前询问' },
    { id: 'plan', name: 'Plan', desc: '只读探索，先给出计划，批准后再动手' },
    { id: 'bypass', name: 'Bypass permissions', desc: '完全不询问，仅建议在隔离环境中使用' },
  ];
  const LEVEL_LABEL = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
  const PERM_OPTIONS = ['Allow', 'Always allow', 'Deny'];
  const PLAN_OPTIONS = ['Approve & auto-accept edits', 'Approve, ask for edits', 'Keep planning'];
  const VIEW_MODES = [
    { id: 'normal', name: 'Normal', desc: 'Tool calls collapsed into summaries' },
    { id: 'thinking', name: 'Thinking', desc: 'Summaries plus Claude’s thinking' },
    { id: 'verbose', name: 'Verbose', desc: 'Every tool call, read, and step' },
  ];
  const OUTPUT_STYLES = [
    { id: 'default', name: 'Default', desc: 'Standard software-engineering behavior' },
    { id: 'proactive', name: 'Proactive', desc: 'Act on reasonable assumptions' },
    { id: 'concise', name: 'Concise', desc: 'Lead with the result, skip narration' },
    { id: 'explanatory', name: 'Explanatory', desc: 'Add short insights while working' },
    { id: 'learning', name: 'Learning', desc: 'Learn by completing small pieces yourself' },
  ];
  const DESKTOP_CMDS = [
    ['/clear', '开始新的上下文（保留会话）'],
    ['/compact', '压缩对话历史'],
    ['/context', '查看上下文用量'],
    ['/model', '切换模型'],
    ['/permissions', '切换权限模式'],
    ['/export', '导出会话为 HTML'],
    ['/help', '查看命令与快捷键'],
  ];

  const state = {
    info: null,
    cur: null,
    rts: new Map(), // sessionId -> runtime
    projects: [],
    project: store.get('pd_project', null),
    worktree: store.get('pd_worktree', true),
    mode: store.get('pd_mode', 'auto'),
    model: store.get('pd_model', null),
    effort: store.get('pd_effort', 'high'),
    viewMode: store.get('pd_view_mode', 'normal'),
    outputStyle: store.get('pd_output_style', 'default'),
    models: [],
    levels: [],
    importable: [],
    lastByMode: { chat: null, code: null },
    coworkFolder: store.get('pd_cowork_folder', undefined), // undefined = not chosen yet, null = scratch workspace
    coworkFolders: [],
  };
  if (!VIEW_MODES.some((m) => m.id === state.viewMode)) state.viewMode = 'normal';
  if (!OUTPUT_STYLES.some((s) => s.id === state.outputStyle)) state.outputStyle = 'default';
  const isCowork = (rt) => rt?.meta.kind === 'cowork';
  const curRt = () => state.rts.get(state.cur);
  const isCur = (rt) => rt && rt.meta.id === state.cur;
  const fname = (p) => String(p).split(/[\\/]/).pop();
  const fdir = (p) => String(p).split(/[\\/]/).slice(0, -1).join('/');
  const projName = (p) => fname(p || '');

  function runtime(meta) {
    let rt = state.rts.get(meta.id);
    if (rt) { rt.meta = meta; return rt; }
    rt = {
      meta, events: [], loaded: false, running: meta.status === 'running', statusText: '', t0: 0, tokens: 0,
      ctxPct: null, cur: null, tools: new Map(), todosEv: null, pendingUser: [], submitting: null, stopping: false, processVersion: 0, perm: null, unread: false,
      changes: [], pr: meta.pr || null, prHidden: false, diffOpen: false, previewOpen: false, filesOpen: false, terminalOpen: false, bottom: null,
      openGaps: new Set(), collapsed: new Set(), term: [], commands: [], files: null, model: null, levels: [],
      outputs: [], panelOpen: innerWidth > 1180, fileDirs: new Set(), fileFilter: '',
    };
    state.rts.set(meta.id, rt);
    return rt;
  }

  const composer = window.PiComposer.create({ api, onChange() {
    autosize();
    autosizeCowork();
    updateSendBtn();
  } });
  const welcomeDraftKey = () => `welcome:${document.body.dataset.mode}:${document.body.dataset.mode === 'chat' ? state.coworkFolder || 'scratch' : state.project || 'none'}`;
  const sessionDraftKey = (rt) => `session:${rt.meta.id}`;

  /* ================= 事件渲染 ================= */
  function questionTitle(title) {
    // RPC question tools fold optional previews into a multi-line dialog title.
    const [question, ...previews] = String(title || '').split(/\n\n(?=--- \d+\. [^\n]+ preview ---\n)/);
    return `<div class="p-t p-question">${esc(question)}</div>` + previews.map((preview) => {
      const line = preview.indexOf('\n');
      return `<details class="ask-preview"><summary>${esc(preview.slice(0, line).replace(/^--- | ---$/g, ''))}</summary><pre class="mbox">${esc(preview.slice(line + 1))}</pre></details>`;
    }).join('');
  }
  function resolvedPrompt(label, subject, denied = false) {
    return `<span class="p-res-icon">${denied ? '✕' : '✓'}</span><span class="p-res-text" title="${esc(`${label} ${subject || ''}`)}">${esc(label)}${subject ? ` <span class="mono">${esc(subject)}</span>` : ''}</span>`;
  }
  function linkify(root) {
    // Paths may contain non-ASCII names (e.g. 收件箱整理.md:1).
    const re = /((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+\.(?:[a-z]{1,5})):(\d+)/gu;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) { re.lastIndex = 0; if (re.test(walker.currentNode.data)) nodes.push(walker.currentNode); }
    nodes.forEach((n) => {
      const span = document.createElement('span');
      span.innerHTML = esc(n.data).replace(re, (m, p, l) => `<a class="fl" data-p="${p}" data-l="${l}">${m}</a>`);
      n.replaceWith(span);
    });
    root.querySelectorAll('a.fl').forEach((a) => (a.onclick = () => openFileRef(a.dataset.p, +a.dataset.l)));
  }

  function groupSummary(g) {
    const c = { cmd: 0, fail: 0, read: new Set(), edit: new Set(), write: new Set(), search: 0, agent: 0, other: 0 };
    g.tools.forEach((t) => {
      if (t.kind === 'bash') { c.cmd++; if (t.status === 'err') c.fail++; }
      else if (t.kind === 'read') c.read.add(t.path);
      else if (t.kind === 'edit') c.edit.add(t.path);
      else if (t.kind === 'write') c.write.add(t.path);
      else if (['grep', 'glob', 'ls'].includes(t.kind)) c.search++;
      else if (t.kind === 'agent') c.agent++;
      else c.other++;
    });
    const pl = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
    const parts = [];
    if (c.cmd) parts.push(`ran ${pl(c.cmd, 'a command', 'commands')}${c.fail ? ` (${c.fail} failed)` : ''}`);
    if (c.read.size) parts.push(`read ${pl(c.read.size, 'a file', 'files')}`);
    if (c.write.size) parts.push(`wrote ${pl(c.write.size, 'a file', 'files')}`);
    if (c.edit.size) parts.push(`edited ${pl(c.edit.size, 'a file', 'files')}`);
    if (c.search) parts.push(`searched ${pl(c.search, 'once', 'times')}`);
    if (c.agent) parts.push(`used ${pl(c.agent, 'an agent', 'agents')}`);
    if (c.other) parts.push(`used ${pl(c.other, 'a tool', 'tools')}`);
    const s = parts.join(', ') || 'Used tools';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function groupStats(g) {
    return g.tools.reduce((a, t) => {
      if (t.add != null) { a.add += t.add; a.del += t.del; }
      return a;
    }, { add: 0, del: 0 });
  }
  const hasThinking = (rt) => !!rt && rt.events.some((e) =>
    (e.type === 'group' && (e.steps || []).some((s) => s.kind === 'think')) || e.type === 'think');
  function thoughtHTML(step, i) {
    const label = step.done
      ? (step.secs ? `Thought for ${step.secs}s` : 'Thought')
      : '<span class="shimmer">Thinking…</span>';
    return `<details class="g-think" data-t="${i}"${step.open ? ' open' : ''}><summary>${label}${I.cv}</summary><div class="tb"></div></details>`;
  }
  function toolLabel(t) {
    const b = (x) => `<b>${esc(x)}</b>`;
    const st = t.add != null ? `${t.add ? ` <span class="plus">+${t.add}</span>` : ''}${t.del ? ` <span class="minus">−${t.del}</span>` : ''}` : '';
    const run = t.status === 'running';
    switch (t.kind) {
      case 'read': return `${run ? 'Reading' : 'Read'} ${b(fname(t.path))}`;
      case 'edit': return `${run ? 'Editing' : 'Edited'} ${b(fname(t.path))}${st}`;
      case 'write': return `${run ? 'Writing' : 'Wrote'} ${b(fname(t.path))}${st}`;
      case 'grep': return `Searched for ${b(t.q)}`;
      case 'glob': return `Found ${b(t.q)}`;
      case 'ls': return `Listed ${b(t.q || '.')}`;
      case 'bash': return `${run ? 'Running' : 'Ran'} ${b(t.cmd)}`;
      case 'agent': return `Agent · ${b(t.desc)}${t.summary ? ` <span class="dim-s">${esc(t.summary)}</span>` : ''}`;
      default: return `${run ? 'Using' : 'Used'} ${b(t.name)}`;
    }
  }

  function toolRowHTML(t, i) {
    const file = ['read', 'edit', 'write'].includes(t.kind) && t.path;
    const state = `g-row ${t.status}${t.open ? ' open' : ''}`;
    const detail = t.detail ? `<div class="g-det">${t.detail}${file && t.status === 'done' && t.kind !== 'read' ? '<button class="tool-diff-link" data-diff>View diff</button>' : ''}</div>` : '';
    if (!file) return `<div class="${state}" data-i="${i}"><button class="g-rh" aria-expanded="${!!t.open}"><span class="lbl${t.status === 'running' ? ' shimmer' : ''}">${toolLabel(t)}</span>${I.cv}</button>${detail}</div>`;
    const verb = { read: ['Reading', 'Read'], edit: ['Editing', 'Edited'], write: ['Writing', 'Wrote'] }[t.kind][t.status === 'running' ? 0 : 1];
    const stats = t.add != null ? `<span class="plus">+${t.add}</span><span class="minus">−${t.del}</span>` : '';
    return `<div class="${state}" data-i="${i}"><div class="g-rh g-file-rh"><span class="tool-verb">${verb}</span><button class="tool-file" data-file title="Open current file: ${esc(t.path)}">${esc(fname(t.path))}</button>${stats}<button class="tool-row-toggle" data-toggle aria-label="${esc(`Toggle ${verb.toLowerCase()} preview for ${fname(t.path)}`)}" aria-expanded="${!!t.open}" title="Toggle preview">${I.cv}</button></div>${detail}</div>`;
  }

  function renderEvent(ev, rt) {
    const el = document.createElement('div');
    switch (ev.type) {
      case 'user':
        el.className = 'e-user' + (ev.queued ? ' queued' : '') + (ev.failed ? ' failed' : '');
        el.innerHTML = `${ev.attachments?.length ? `<div class="user-attachments">${window.PiComposer.tiles(ev.attachments)}</div>` : ''}${ev.text ? `<div class="bubble">${esc(ev.text).replace(/@([\w./-]+)/g, '<span class="mention">@$1</span>')}</div>` : ''}${ev.notice ? `<div class="attachment-status">${esc(ev.notice)}</div>` : ''}${ev.failed ? '<div class="attachment-error">Delivery not confirmed. Check the conversation before retrying.<button data-recover>Restore draft</button></div>' : ''}`;
        window.PiComposer.wireGallery(el, ev.attachments || []);
        el.querySelector('[data-recover]')?.addEventListener('click', () => composer.recover(sessionDraftKey(rt), ev.submission || ev));
        if (ev.queued) el.title = '排队中：Claude 完成当前步骤后处理';
        break;
      case 'text':
        el.className = 'e-text';
        el.innerHTML = renderMarkdown(ev.text) + (ev.live ? '<span class="cursor-dot"></span>' : '');
        if (!ev.live) { wireCode(el); linkify(el); }
        break;
      case 'note':
        el.className = 'e-note' + (ev.level === 'error' ? ' err' : '');
        el.textContent = ev.text;
        break;
      case 'group': {
        const thoughts = state.viewMode === 'normal' ? [] : (ev.steps || []).filter((s) => s.kind === 'think');
        const running = ev.tools.find((t) => t.status === 'running');
        const { add, del } = groupStats(ev);
        const hidden = !ev.tools.length && !thoughts.length;
        el.className = 'e-group' + (ev.open ? ' open' : '') + (thoughts.length ? ' has-thinking' : '') + (hidden ? ' e-hidden' : '');
        if (hidden) break;
        el.innerHTML = `${thoughts.map(thoughtHTML).join('')}
          ${ev.tools.length ? `<button class="g-sum"><span class="g-label${running ? ' shimmer' : ''}">${running ? `${toolLabel(running)}…` : esc(groupSummary(ev))}</span>
            ${add > 0 ? `<span class="plus stat">+${add}</span>` : ''}${del > 0 ? `<span class="minus stat">−${del}</span>` : ''}${I.cv}</button>` : ''}
          ${ev.tools.length ? `<div class="g-list">${ev.tools.map(toolRowHTML).join('')}</div>` : ''}`;
        el.querySelectorAll('.g-think').forEach((d, i) => {
          const s = thoughts[i];
          d.querySelector('.tb').textContent = s.text;
          d.ontoggle = () => { s.open = d.open; s.userToggled = true; };
        });
        const sum = el.querySelector('.g-sum');
        if (sum) {
          sum.onclick = () => { ev.open = !ev.open; ev.userToggled = true; el.classList.toggle('open', ev.open); };
          sum.title = el.querySelector('.g-label').textContent;
        }
        el.querySelectorAll('.g-row').forEach((row) => {
          const t = ev.tools[+row.dataset.i];
          const header = row.querySelector('.g-rh');
          if (!header.classList.contains('g-file-rh')) header.title = row.querySelector('.lbl').textContent;
          const toggle = row.querySelector('[data-toggle]') || header;
          toggle.onclick = () => {
            if (t.kind === 'agent') return openBottom(rt, { type: 'agent', tool: t });
            t.open = !t.open;
            row.classList.toggle('open', t.open);
            toggle.setAttribute('aria-expanded', String(t.open));
          };
          row.querySelector('[data-file]')?.addEventListener('click', () => openFileRef(t.path, t.kind === 'read' ? t.args?.offset : t.firstChangedLine, rt));
          row.querySelector('[data-diff]')?.addEventListener('click', () => openDiffRef(rt, t.path));
        });
        break;
      }
      case 'todos':
        el.className = 'e-todos';
        el.innerHTML = ev.items.map((t) => `<div class="td ${t.status}"><span class="td-box"></span><span>${esc(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content)}</span></div>`).join('');
        break;
      case 'perm': {
        if (ev.resolved) {
          el.className = 'e-perm res';
          el.innerHTML = resolvedPrompt({ Allow: 'Allowed', 'Always allow': 'Always allowed', Deny: 'Denied', cancelled: 'Cancelled' }[ev.resolved] || ev.resolved, ev.subject, ev.resolved === 'Deny' || ev.resolved === 'cancelled');
          break;
        }
        el.className = 'e-perm';
        const t = ev.tool || {};
        let preview = '';
        if (t.kind === 'bash') preview = `<pre class="mbox"><span class="cmd">${esc(t.cmd)}</span></pre>`;
        else if (t.kind === 'edit') preview = (t.args?.edits || []).slice(0, 6).map((e) => smallDiff(e.oldText, e.newText, t.path)).join('');
        else if (t.kind === 'write') preview = toolPreviewHTML({ ...previews.write(t.args), note: 'Content to write · previous version unavailable' }, t.path);
        else if (t.args) preview = `<pre class="mbox">${esc(JSON.stringify(t.args, null, 2).slice(0, 2000))}</pre>`;
        const always = t.kind === 'bash' ? `Always allow <span class="mono">${esc(t.cmd.split(/\s+/).slice(0, 2).join(' '))}</span>` : t.kind === 'edit' || t.kind === 'write' ? 'Allow all edits this session' : 'Always allow';
        el.innerHTML = `<div class="p-t">${esc(ev.title)}</div>${preview}
          <div class="p-acts">
            <button class="p-btn primary" data-v="Allow">Allow <kbd>1</kbd></button>
            <button class="p-btn" data-v="Always allow" title="${esc(t.kind === 'bash' ? `Always allow ${t.cmd.split(/\s+/).slice(0, 2).join(' ')}` : 'Allow all edits this session')}"><span class="p-btn-label">${always}</span><kbd>2</kbd></button>
            <button class="p-btn" data-v="Deny">Deny <kbd>3</kbd></button>
          </div>`;
        el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => answerUi(rt, ev, { value: b.dataset.v }, b.dataset.v)));
        break;
      }
      case 'ask': {
        // Generic extension dialog (select / confirm / input / editor).
        el.className = 'e-perm e-ask' + (ev.resolved ? ' res' : '');
        if (ev.resolved) { el.innerHTML = resolvedPrompt(ev.title.split('\n')[0], ev.resolved, ev.resolved === 'cancelled'); break; }
        const r = ev.req;
        let body = '';
        if (r.method === 'select') body = `<div class="p-options">${r.options.map((o, i) => {
          const split = o.indexOf(' — ');
          return `<button class="p-btn p-option${i === 0 ? ' primary' : ''}" data-v="${esc(o)}"><span>${esc(split < 0 ? o : o.slice(0, split))}</span>${split < 0 ? '' : `<small>${esc(o.slice(split + 3))}</small>`}</button>`;
        }).join('')}</div><div class="p-acts"><button class="p-btn" data-c>Cancel</button></div>`;
        else if (r.method === 'confirm') body = `<div class="p-desc">${esc(r.message || '')}</div><div class="p-acts"><button class="p-btn primary" data-yes>Yes</button><button class="p-btn" data-no>No</button></div>`;
        else body = `<textarea class="ask-in" rows="${r.method === 'editor' ? 6 : 1}" placeholder="${esc(r.placeholder || '')}">${esc(r.prefill || '')}</textarea><div class="p-acts"><button class="p-btn primary" data-ok>OK</button><button class="p-btn" data-c>Cancel</button></div>`;
        el.innerHTML = questionTitle(r.title) + body;
        el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => answerUi(rt, ev, { value: b.dataset.v }, b.dataset.v)));
        el.querySelector('[data-yes]')?.addEventListener('click', () => answerUi(rt, ev, { confirmed: true }, 'Yes'));
        el.querySelector('[data-no]')?.addEventListener('click', () => answerUi(rt, ev, { confirmed: false }, 'No'));
        el.querySelector('[data-ok]')?.addEventListener('click', () => answerUi(rt, ev, { value: el.querySelector('.ask-in').value }, 'OK'));
        el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => answerUi(rt, ev, { cancelled: true }, 'cancelled')));
        break;
      }
      case 'plan':
        el.className = 'e-plan';
        el.innerHTML = `<div class="pl-h"><svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3.5h8a1.5 1.5 0 0 1 1.5 1.5v11L10 13l-5.5 3V5A1.5 1.5 0 0 1 6 3.5z"/></svg><span class="tt">${esc(ev.title)}</span><span class="open">Open plan</span>${I.cv}</div>
          ${ev.resolved ? `<div class="st">${ev.resolved === 'Keep planning' ? 'Revising plan' : ev.resolved === 'cancelled' ? 'Cancelled' : '✓ Plan approved'}</div>` : ev.reqId ? planActions() : ''}`;
        el.querySelector('.pl-h').onclick = () => openBottom(rt, { type: 'plan', ev });
        el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => answerUi(rt, ev, { value: b.dataset.a }, b.dataset.a)));
        break;
      case 'foot':
        el.className = 'e-foot';
        el.innerHTML = `<button class="ic-btn" data-a="copy" title="Copy">${I.copy}</button><button class="ic-btn" data-a="fork" title="Fork session">${I.fork}</button><span class="when">${ago(ev.t, true)}</span>${ev.usage ? `<span class="when">· ${esc(ev.usage)}</span>` : ''}`;
        el.querySelector('[data-a=copy]').onclick = () => {
          const i = rt.events.indexOf(ev);
          const txt = rt.events.slice(0, i).reverse().find((e) => e.type === 'text');
          navigator.clipboard.writeText(txt?.text || '').then(() => toast('Copied'));
        };
        el.querySelector('[data-a=fork]').onclick = () => rpc(rt, { type: 'clone' }).then(() => toast('已复制为新的 pi 会话分支（可在 CLI 中 /resume）')).catch(fail);
        break;
    }
    return el;
  }
  const planActions = () => `<div class="p-acts">${PLAN_OPTIONS.map((o, i) => `<button class="p-btn${i === 0 ? ' primary' : ''}" data-a="${o}">${o}</button>`).join('')}</div>`;

  /* ---------- 会话流 DOM（rAF 合并重绘） ---------- */
  const statusEl = document.createElement('div');
  statusEl.className = 'status-line';
  const nearBottom = () => msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 160;
  const toBottom = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };
  const dirty = new Set();
  let raf = 0;
  function push(rt, ev) {
    const last = rt.events.at(-1);
    if (state.viewMode !== 'verbose' && ev.type !== 'group' && ev.type !== 'perm' && last?.type === 'group' && last.open && !last.userToggled && !last.tools.some((t) => t.status === 'running')) {
      last.open = false;
      update(rt, last);
    }
    rt.events.push(ev);
    if (isCur(rt)) {
      const stick = nearBottom();
      ev.el = renderEvent(ev, rt);
      msgsEl.insertBefore(ev.el, statusEl);
      if (stick) toBottom();
    }
    return ev;
  }
  function update(rt, ev) {
    if (!isCur(rt) || !ev.el) return;
    dirty.add(ev);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function flush() {
    raf = 0;
    const rt = curRt();
    const stick = nearBottom();
    for (const ev of dirty) {
      if (!ev.el?.isConnected) continue;
      const n = renderEvent(ev, rt);
      ev.el.replaceWith(n);
      ev.el = n;
    }
    dirty.clear();
    if (stick) toBottom();
  }
  function renderThread() {
    const rt = curRt();
    msgsEl.innerHTML = '';
    msgsEl.appendChild(statusEl);
    for (const ev of rt.events) {
      ev.el = renderEvent(ev, rt);
      msgsEl.insertBefore(ev.el, statusEl);
    }
    updateStatus();
    toBottom();
  }
  const fmtDur = (ms) => {
    const t = Math.round(ms / 1000);
    if (t < 60) return `${t}s`;
    if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`;
    return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
  };
  const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  function updateStatus() {
    const rt = curRt();
    const ring = $('#ctxRing');
    if (!rt) { ring.classList.remove('busy'); return; }
    if (rt.running) {
      statusEl.innerHTML = `<span class="spark spin"></span><span>${fmtDur(Date.now() - rt.t0)} · ${fmtTok(rt.tokens)} tokens · ${esc(rt.perm ? 'Waiting for you…' : rt.statusText || 'Thinking…')}</span>`;
    } else statusEl.innerHTML = rt.events.length ? '<span class="spark"></span>' : '';
    const pct = rt.ctxPct ?? 0;
    $('#ctxArc').setAttribute('stroke-dasharray', `${((pct / 100) * 44).toFixed(1)} 44`);
    ring.title = rt.ctxPct == null ? 'Context' : `Context: ${Math.round(pct)}% used`;
    ring.classList.toggle('busy', rt.running);
    $('#clawd').classList.toggle('busy', rt.running);
  }
  setInterval(() => { if (curRt()?.running) updateStatus(); }, 500);

  /* ================= pi 事件 → 界面 ================= */
  const KIND = { read: 'read', edit: 'edit', write: 'write', bash: 'bash', powershell: 'bash', grep: 'grep', find: 'glob', ls: 'ls', task: 'agent' };
  function toolFromArgs(id, name, args = {}) {
    const kind = KIND[name] || 'other';
    return {
      id, name, kind, args, status: 'running', open: false,
      path: args.path || args.file_path, cmd: args.command || '', q: args.pattern || args.path || '',
      desc: args.description || 'Subagent', prompt: args.prompt,
    };
  }
  function currentGroup(rt) {
    const last = rt.events.at(-1);
    if (last?.type === 'group') return last;
    return push(rt, { type: 'group', steps: [], tools: [], open: state.viewMode === 'verbose' });
  }
  function addThought(rt) {
    const g = currentGroup(rt);
    const step = { kind: 'think', text: '', done: false, t0: Date.now(), open: true, userToggled: false };
    g.steps.push(step);
    update(rt, g);
    return { step, group: g };
  }
  function setStatusText(rt, t) {
    rt.statusText = t;
    if (isCur(rt)) updateStatus();
  }

  function onToolStart(rt, { toolCallId, toolName, args }, replay) {
    if (toolName === 'todo_write') return;
    if (toolName === 'exit_plan_mode') {
      const ev = push(rt, { type: 'plan', title: args?.title || 'Plan', md: args?.plan || '', toolCallId, reqId: null, resolved: replay ? 'done' : null });
      rt.tools.set(toolCallId, { plan: ev });
      return;
    }
    const t = toolFromArgs(toolCallId, toolName, args);
    const g = currentGroup(rt);
    g.tools.push(t);
    g.steps.push(t);
    rt.tools.set(toolCallId, { tool: t, group: g });
    update(rt, g);
    if (!replay) {
      const label = document.createElement('span');
      label.innerHTML = toolLabel(t);
      setStatusText(rt, label.textContent + '…');
    }
  }

  function onToolEnd(rt, { toolCallId, toolName, result, isError }, replay) {
    const text = contentText(result?.content);
    if (toolName === 'todo_write') {
      const items = result?.details?.todos;
      if (!items) return;
      if (rt.todosEv) { rt.todosEv.items = items; update(rt, rt.todosEv); }
      else rt.todosEv = push(rt, { type: 'todos', items });
      rt.lastTodos = items;
      if (isCur(rt) && isCowork(rt)) renderCoworkPanel(rt);
      return;
    }
    const entry = rt.tools.get(toolCallId);
    if (!entry) return;
    if (entry.plan) {
      const st = result?.details?.status;
      entry.plan.resolved = st === 'approved' ? 'approved' : st === 'keep' ? 'Keep planning' : entry.plan.resolved || 'done';
      update(rt, entry.plan);
      return;
    }
    const t = entry.tool;
    const blocked = isError && /denied|Plan mode|blocked|not approved|no UI/i.test(text);
    t.status = blocked ? 'denied' : isError ? 'err' : 'done';
    if (['read', 'edit', 'write'].includes(t.kind)) {
      const preview = previews[t.kind](t.args, result, !!isError);
      t.detail = toolPreviewHTML(preview, t.path);
      t.firstChangedLine = preview.firstChangedLine;
      if (preview.type === 'diff') { t.add = preview.add; t.del = preview.del; }
    }
    if (t.kind === 'read') { /* Preview prepared above for live events and history. */ }
    else if (t.kind === 'bash') t.detail = termBox(t.cmd, text);
    else if (t.kind === 'edit' || t.kind === 'write') {
      if (!isError && t.path) {
        const rel = relPath(rt, t.path);
        const prev = rt.outputs.find((o) => o.path === rel);
        if (prev) prev.t = Date.now();
        else rt.outputs.push({ path: rel, kind: t.kind, t: Date.now() });
        if (!replay && isCur(rt) && isCowork(rt)) renderCoworkPanel(rt);
      }
      if (!replay) scheduleChanges(rt);
    } else if (t.kind === 'agent') {
      t.md = result?.details?.text || text;
      t.summary = result?.details?.summary || '';
      if (rt.bottom?.tool === t) renderBottom(rt);
    } else t.detail = `<pre class="mbox">${esc(text.slice(0, 8000))}</pre>`;
    if (t.kind === 'bash' && !replay) {
      rt.term.push({ cmd: t.cmd, out: text });
      if (rt.terminalOpen) renderTerminal(rt);
      if (!isError && /\bgh\s+pr\s+(?:create|merge|close|reopen|ready|edit)\b/i.test(t.cmd)) {
        // gh can take a moment to expose a just-created PR through `pr view`.
        const created = /\bgh\s+pr\s+create\b/i.test(t.cmd) && text.match(/https?:\/\/[^\s<>"'`]+\/pull\/(\d+)/i);
        if (created) {
          rt.pr = { num: +created[1], url: created[0], state: 'open', draft: /(?:^|\s)--draft\b/.test(t.cmd), ci: 'none', checks: [], comments: 0 };
          rt.meta.pr = { num: rt.pr.num, url: rt.pr.url, state: rt.pr.state, draft: rt.pr.draft };
          call('sessions:update', rt.meta.id, { pr: rt.meta.pr }).catch(() => {});
          if (isCur(rt)) renderPrBar();
          renderSessions();
        }
        pollPr(rt, 3);
      }
    }
    update(rt, entry.group);
  }

  function assistantDelta(rt, ame) {
    const c = rt.cur || (rt.cur = { think: null, text: null, t0: Date.now() });
    switch (ame.type) {
      case 'thinking_start':
        c.think = addThought(rt);
        setStatusText(rt, 'Thinking…');
        break;
      case 'thinking_delta':
        if (!c.think) c.think = addThought(rt);
        c.think.step.text += ame.delta;
        update(rt, c.think.group);
        break;
      case 'thinking_end':
        if (c.think) {
          const s = c.think.step;
          s.text = ame.content ?? s.text;
          s.done = true;
          s.secs = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
          if (!s.userToggled) s.open = state.viewMode === 'verbose';
          update(rt, c.think.group);
        }
        break;
      case 'text_start':
        c.text = push(rt, { type: 'text', text: '', live: true });
        setStatusText(rt, 'Responding…');
        break;
      case 'text_delta':
        if (!c.text) c.text = push(rt, { type: 'text', text: '', live: true });
        c.text.text += ame.delta;
        rt.tokens += Math.ceil(ame.delta.length / 3);
        update(rt, c.text);
        break;
      case 'text_end':
        if (c.text) { c.text.text = ame.content ?? c.text.text; c.text.live = false; update(rt, c.text); c.text = null; }
        break;
      case 'toolcall_start':
        setStatusText(rt, `Preparing ${ame.toolName || 'tool'}…`);
        break;
    }
  }

  function onPiEvent(sessionId, ev) {
    const rt = state.rts.get(sessionId);
    if (!rt) return;
    switch (ev.type) {
      case 'agent_start':
        if (!rt.running) { rt.running = true; rt.t0 = Date.now(); rt.tokens = 0; rt.todosEv = null; }
        setStatusText(rt, 'Thinking…');
        renderSessions(); updateSendBtn();
        break;
      case 'message_start':
        if (ev.message?.role === 'assistant') rt.cur = { think: null, text: null, t0: Date.now() };
        break;
      case 'message_update':
        if (ev.assistantMessageEvent) assistantDelta(rt, ev.assistantMessageEvent);
        break;
      case 'message_end': {
        const m = ev.message || {};
        if (m.role === 'user') {
          const user = attachments.decodeUserContent(m.content);
          if (user.text.startsWith('[pi-desktop]')) break;
          const i = user.clientId
            ? rt.pendingUser.findIndex((p) => p.clientId === user.clientId)
            : rt.pendingUser.findIndex((p) => !p.attachments?.length && p.text === user.text);
          if (i >= 0) {
            const [p] = rt.pendingUser.splice(i, 1);
            Object.assign(p, user, { queued: false, delivered: true, failed: false });
            update(rt, p);
          } else if (!user.clientId || !rt.events.some((p) => p.type === 'user' && p.clientId === user.clientId)) push(rt, { type: 'user', ...user, delivered: true });
        } else if (m.role === 'assistant') {
          const c = rt.cur || {};
          // message_end is authoritative: reconcile streamed text/thinking with the final content.
          const finalText = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          if (c.text) { c.text.text = finalText || c.text.text; c.text.live = false; update(rt, c.text); }
          else if (finalText && !rt.events.some((e) => e.type === 'text' && e.msgTs === m.timestamp)) {
            const last = rt.events.at(-1);
            if (!(last?.type === 'text' && last.text === finalText)) push(rt, { type: 'text', text: finalText, live: false, msgTs: m.timestamp });
          }
          if (c.think && !c.think.step.done) {
            const s = c.think.step;
            s.done = true;
            s.secs = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
            if (!s.userToggled) s.open = state.viewMode === 'verbose';
            update(rt, c.think.group);
          }
          if (m.usage) rt.tokens = rt.tokens + (m.usage.output || 0);
          if (m.stopReason === 'error' && m.errorMessage) push(rt, { type: 'note', level: 'error', text: `Error: ${m.errorMessage}` });
          if (m.stopReason === 'aborted') push(rt, { type: 'note', text: 'Interrupted · 告诉 Claude 接下来该怎么做' });
          rt.cur = null;
        } else if (m.role === 'custom' && m.display) push(rt, { type: 'note', text: contentText(m.content) });
        break;
      }
      case 'tool_execution_start':
        if (ev.parentToolCallId) break;
        onToolStart(rt, ev);
        break;
      case 'tool_execution_update':
        if (ev.toolName === 'task') {
          const e = rt.tools.get(ev.toolCallId);
          if (e?.tool) { e.tool.summary = contentText(ev.partialResult?.content); update(rt, e.group); }
        }
        break;
      case 'tool_execution_end':
        if (ev.parentToolCallId) break;
        onToolEnd(rt, ev);
        break;
      case 'extension_ui_request':
        onUiRequest(rt, ev);
        break;
      case 'auto_retry_start':
        push(rt, { type: 'note', text: `Retrying (${ev.attempt}/${ev.maxAttempts}) — ${ev.errorMessage || ''}` });
        break;
      case 'compaction_start':
        setStatusText(rt, 'Compacting context…');
        break;
      case 'compaction_end':
        if (!ev.aborted) push(rt, { type: 'note', text: ev.errorMessage ? `Compaction failed: ${ev.errorMessage}` : 'Context compacted' });
        break;
      case 'queue_update':
        break;
      case 'session_info_changed':
        if (ev.name) { rt.meta.title = ev.name; refreshChrome(); }
        break;
      case 'extension_error':
        toast(`Extension error: ${ev.error}`);
        break;
      case 'agent_settled':
        settle(rt, ev.aborted);
        break;
    }
  }

  function settle(rt, aborted) {
    if (!rt.running) return;
    rt.running = false;
    rt.cur = null;
    rt.events.forEach((e) => {
      if (e.type === 'text' && e.live) { e.live = false; update(rt, e); }
      if (e.type === 'group') {
        let changed = false;
        (e.steps || []).forEach((s) => {
          if (s.kind === 'think' && !s.done) {
            s.done = true;
            s.secs = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
            if (!s.userToggled) s.open = state.viewMode === 'verbose';
            changed = true;
          }
        });
        if (e.tools.some((t) => t.status === 'running')) {
          e.tools.forEach((t) => t.status === 'running' && (t.status = 'denied'));
          changed = true;
        }
        if (changed) update(rt, e);
      }
    });
    // Only authoritative user events or clear_queue confirm consumption/cancellation.
    rt.pendingUser.forEach((p) => { if (!p.queued && !p.delivered) { p.failed = true; update(rt, p); } });
    push(rt, { type: 'foot', t: Date.now(), usage: `${fmtDur(Date.now() - rt.t0)} · ${fmtTok(rt.tokens)} tokens` });
    rt.meta.updatedAt = Date.now();
    if (!isCur(rt) || document.hidden) {
      rt.unread = !isCur(rt);
      call('app:notify', { title: rt.meta.title, body: aborted ? 'Interrupted' : 'Claude finished' }).catch(() => {});
    }
    refreshStats(rt);
    scheduleChanges(rt);
    // A session without a PR may have created its first one during this turn.
    pollPr(rt);
    refreshChrome();
  }

  function onUiRequest(rt, req) {
    const m = req.method;
    if (m === 'setStatus') {
      if (req.statusKey === 'pi-desktop-mode' && req.statusText) {
        rt.meta.mode = req.statusText;
        if (isCur(rt)) showMode(req.statusText);
      }
      if (req.statusKey === 'pi-desktop-output-style' && req.statusText) {
        rt.meta.outputStyle = req.statusText;
        if (isCur(rt)) renderSessMenu();
      }
      return;
    }
    if (m === 'notify') return toast(req.message);
    if (m === 'set_editor_text') { if (isCur(rt)) { codeInput.value = req.text; autosize(); updateSendBtn(); } return; }
    if (m === 'setTitle' || m === 'setWidget') return;
    if (!['select', 'confirm', 'input', 'editor'].includes(m)) return;

    const title = req.title || '';
    const perm = title.match(/^\[\[pi-desktop:perm:([^\]]+)\]\]\s*(.*)$/s);
    const plan = title.match(/^\[\[pi-desktop:plan:([^\]]+)\]\]\s*(.*)$/s);
    let ev;
    if (perm) {
      const entry = rt.tools.get(perm[1]);
      const tool = entry?.tool;
      ev = push(rt, { type: 'perm', reqId: req.id, title: permTitle(tool, perm[2]), subject: tool?.kind === 'bash' ? tool.cmd : tool?.path || perm[2], tool, resolved: null });
    } else if (plan) {
      const entry = rt.tools.get(plan[1]);
      ev = entry?.plan || push(rt, { type: 'plan', title: plan[2], md: '', resolved: null });
      ev.reqId = req.id;
      update(rt, ev);
      openBottom(rt, { type: 'plan', ev }, true);
    } else {
      ev = push(rt, { type: 'ask', reqId: req.id, req, title, resolved: null });
    }
    rt.perm = ev;
    renderSessions();
    if (isCur(rt)) updateStatus();
    if (!isCur(rt) || document.hidden) {
      toast(`“${rt.meta.title}” 需要你的确认`);
      call('app:notify', { title: rt.meta.title, body: 'Needs your approval' }).catch(() => {});
    }
  }
  function permTitle(tool, raw) {
    if (!tool) return raw;
    if (tool.kind === 'bash') return 'Allow Claude to run this command?';
    if (tool.kind === 'edit') return `Allow Claude to edit ${tool.path}?`;
    if (tool.kind === 'write') return `Allow Claude to write ${tool.path}?`;
    return `Allow Claude to use ${tool.name}?`;
  }
  function answerUi(rt, ev, payload, label) {
    if (ev.resolved && ev.type !== 'plan') return;
    call('sessions:ui', rt.meta.id, ev.reqId, payload).catch(fail);
    ev.resolved = label;
    ev.reqId = null;
    if (rt.perm === ev) rt.perm = null;
    update(rt, ev);
    if (rt.bottom?.ev === ev) renderBottom(rt);
    renderSessions();
    updateStatus();
  }

  // Rebuild the transcript from pi's message list (session resume).
  function replay(rt, messages) {
    rt.events = [];
    rt.tools.clear();
    rt.todosEv = null;
    let sawAssistant = false;
    for (const m of messages) {
      if (m.role === 'user') {
        const user = attachments.decodeUserContent(m.content);
        if (user.text.startsWith('[pi-desktop]')) continue;
        if (sawAssistant) rt.events.push({ type: 'foot', t: m.timestamp || Date.now() });
        sawAssistant = false;
        rt.todosEv = null;
        rt.events.push({ type: 'user', ...user, delivered: true });
      } else if (m.role === 'assistant') {
        sawAssistant = true;
        for (const b of m.content || []) {
          if (b.type === 'thinking' && b.thinking) {
            let g = rt.events.at(-1);
            if (g?.type !== 'group') { g = { type: 'group', steps: [], tools: [], open: state.viewMode === 'verbose' }; rt.events.push(g); }
            g.steps.push({ kind: 'think', text: b.thinking, done: true, open: state.viewMode === 'verbose' });
          }
          else if (b.type === 'text' && b.text) rt.events.push({ type: 'text', text: b.text, live: false });
          else if (b.type === 'toolCall') onToolStart(rt, { toolCallId: b.id, toolName: b.name, args: b.arguments }, true);
        }
        if (m.stopReason === 'error' && m.errorMessage) rt.events.push({ type: 'note', level: 'error', text: `Error: ${m.errorMessage}` });
      } else if (m.role === 'toolResult') {
        onToolEnd(rt, { toolCallId: m.toolCallId, toolName: m.toolName, result: { content: m.content, details: m.details }, isError: m.isError }, true);
      } else if (m.role === 'custom' && m.display) {
        rt.events.push({ type: 'note', text: contentText(m.content) });
      }
    }
    if (sawAssistant) rt.events.push({ type: 'foot', t: rt.meta.updatedAt });
    rt.events.forEach((e) => { if (e.type === 'group') e.open = state.viewMode === 'verbose'; });
  }

  /* ================= 与主进程交互 ================= */
  const rpc = (rt, command) => call('sessions:rpc', rt.meta.id, command);

  async function refreshStats(rt) {
    try {
      const s = await rpc(rt, { type: 'get_session_stats' });
      rt.ctxPct = s?.contextUsage?.percent ?? rt.ctxPct;
      if (isCur(rt)) updateStatus();
    } catch {}
  }
  const changeTimers = new Map();
  function scheduleChanges(rt) {
    clearTimeout(changeTimers.get(rt.meta.id));
    changeTimers.set(rt.meta.id, setTimeout(() => loadChanges(rt), 250));
  }
  async function loadChanges(rt) {
    if (isCowork(rt)) return;
    try {
      rt.changes = await call('sessions:changes', rt.meta.id);
      rt.changes.forEach((f) => Object.assign(f, f.binary ? { add: 0, del: 0 } : diffStats(f.before, f.after)));
      if (rt.changes.length && !rt.autoOpened && innerWidth > 1180 && isCur(rt)) { rt.autoOpened = true; rt.diffOpen = true; }
      if (isCur(rt)) { renderPrBar(); renderRight(); }
    } catch {}
  }
  const prTimers = new Map();
  async function pollPr(rt, retries = 0) {
    clearTimeout(prTimers.get(rt.meta.id));
    if (isCowork(rt) || rt.meta.archived) return;
    rt.prRetries = Math.max(rt.prRetries || 0, retries);
    const request = rt.prRequest = (rt.prRequest || 0) + 1;
    try {
      const pr = await call('sessions:pr', rt.meta.id);
      if (request !== rt.prRequest || rt.meta.archived) return;
      if (pr) {
        rt.prRetries = 0;
        const prevCi = rt.pr?.ci;
        rt.pr = pr;
        rt.meta.pr = { num: pr.num, url: pr.url, state: pr.state, draft: pr.draft };
        if (prevCi === 'pending' && ['pass', 'fail'].includes(pr.ci)) toast(`PR #${pr.num} · CI ${pr.ci === 'pass' ? 'passed' : 'failed'}`);
        if (isCur(rt)) renderPrBar();
        renderSessions();
        if (pr.state === 'open') prTimers.set(rt.meta.id, setTimeout(() => pollPr(rt), pr.ci === 'pending' ? 15000 : 60000));
        return;
      }
    } catch {}
    if (request === rt.prRequest && !rt.meta.archived && (rt.prRetries || rt.pr?.state === 'open')) {
      const retry = rt.prRetries > 0;
      if (retry) rt.prRetries--;
      prTimers.set(rt.meta.id, setTimeout(() => pollPr(rt), retry ? 1500 : 60000));
    }
  }

  /* ================= 发送 ================= */
  async function send(queueOnly) {
    const draft = composer.current();
    if (!draft || draft.sending) return;
    if (draft.preparing) return toast('等待附件处理完成后再发送');
    const { text, attachments: files } = composer.snapshot(draft);
    let rt = curRt();
    if (rt?.stopping) return;
    if (!text.trim() && !files.length) { if (rt?.running) stop(rt); return; }
    const head = text.trim().split(/\s+/)[0];
    if (files.length && head.startsWith('/')) return toast('斜杠命令不能携带附件；请先移除附件或使用普通消息');

    if (head === '/model' || head === '/permissions') { clearInput(); openPop(head === '/model' ? '#codeModelMenu' : '#permMenu'); return; }
    if (head === '/help') {
      clearInput();
      if (!rt) return toast('先开始一个会话');
      push(rt, { type: 'text', text: `### Commands\n${[...DESKTOP_CMDS, ...rt.commands.map((c) => [`/${c.name}`, c.description || c.source])].map(([k, d]) => `- \`${k}\` ${d}`).join('\n')}\n\n### Shortcuts\n- \`↵\` 发送（运行中会插话）· \`Ctrl/⌘ ↵\` 排队到当前任务之后 · \`⇧↵\` 换行\n- \`⇧Tab\` 切换模式 · \`Esc\` 中断
- \`Ctrl/⌘ O\` 切换 transcript 视图（Normal / Thinking / Verbose）\n- \`Ctrl/⌘ K\` 搜索 · \`Ctrl/⌘ .\` 侧边栏 · \`Ctrl/⌘ D\` Diff\n- 输入 \`@\` 引用文件` });
      return;
    }
    if (rt && ['/clear', '/compact', '/context', '/export'].includes(head)) {
      clearInput();
      try {
        if (head === '/clear') {
          await rpc(rt, { type: 'new_session' });
          rt.events = []; rt.todosEv = null; rt.ctxPct = 0;
          renderThread();
          toast('Started a fresh context');
        } else if (head === '/compact') {
          setStatusText(rt, 'Compacting…');
          const r = await rpc(rt, { type: 'compact', customInstructions: text.slice(head.length).trim() || undefined });
          push(rt, { type: 'note', text: `Compacted · ${fmtTok(r.tokensBefore)} → ~${fmtTok(r.estimatedTokensAfter)} tokens` });
          refreshStats(rt);
        } else if (head === '/context') {
          const s = await rpc(rt, { type: 'get_session_stats' });
          const u = s.contextUsage;
          push(rt, { type: 'text', text: `### Context\n- 当前用量：${u?.tokens != null ? `${fmtTok(u.tokens)} / ${fmtTok(u.contextWindow)}（${Math.round(u.percent)}%）` : '未知'}\n- 消息：${s.userMessages} 条用户消息，${s.assistantMessages} 条回复，${s.toolCalls} 次工具调用\n- 累计 tokens：输入 ${fmtTok(s.tokens.input)}，输出 ${fmtTok(s.tokens.output)}，缓存读取 ${fmtTok(s.tokens.cacheRead)}\n- 费用：$${(s.cost || 0).toFixed(4)}\n\n用量高时运行 \`/compact\`。` });
        } else if (head === '/export') {
          const r = await rpc(rt, { type: 'export_html' });
          toast(`Exported to ${r.path}`);
        }
      } catch (err) { fail(err); }
      return;
    }

    if (!rt && document.body.dataset.mode === 'code' && !state.project) return toast('先选择一个项目');
    composer.lock(draft, true);
    if (!rt) {
      try { rt = await createSession(text || files[0]?.name || 'Attachments', draft); }
      catch (err) { composer.lock(draft, false); return composer.error(draft, err); }
    }
    const clientId = crypto.randomUUID();
    const submission = { text, attachments: files, clientId };
    let wire;
    try { wire = attachments.buildMessage(submission); }
    catch (err) { composer.lock(draft, false); return composer.error(draft, err); }
    const wasRunning = rt.running;
    const ev = push(rt, { type: 'user', ...submission, submission, wire: wire.message, queued: wasRunning, acknowledged: false });
    rt.pendingUser.push(ev);
    let finishSubmission;
    const submitting = rt.submitting = new Promise((resolve) => { finishSubmission = resolve; });
    if (isCur(rt)) toBottom();
    const optimistic = !wasRunning && !text.startsWith('/');
    if (optimistic) { rt.running = true; rt.t0 = Date.now(); rt.tokens = 0; rt.todosEv = null; setStatusText(rt, 'Thinking…'); renderSessions(); updateSendBtn(); }
    try {
      const r = await call('sessions:prompt', rt.meta.id, files.length ? submission : text, queueOnly ? 'followUp' : 'steer');
      if (ev.exited) { composer.error(draft, '进程已退出，发送状态未确认；草稿已保留，请核对历史后再发送'); return; }
      ev.acknowledged = true;
      composer.clear(draft);
      if (r?.disposition === 'handled') {
        removeUser(rt, ev);
        if (optimistic) { rt.running = false; refreshChrome(); }
      } else if (wasRunning && isCur(rt)) toast(queueOnly ? 'Queued for after the current task' : 'Claude will see this after the current step');
    } catch (err) {
      if (ev.delivered) composer.clear(draft);
      else if (ev.exited) composer.error(draft, '进程已退出，发送状态未确认；草稿已保留，请核对历史后再发送');
      else if (/exited|closed|timeout|timed out|terminated/i.test(String(err?.message || err))) {
        ev.failed = true; ev.queued = false; update(rt, ev);
        composer.error(draft, '发送状态未确认，请核对会话后再重试，避免重复发送');
      } else { removeUser(rt, ev); composer.error(draft, err); }
      if (optimistic) rt.running = false;
      refreshChrome();
    } finally {
      composer.lock(draft, false);
      if (rt.submitting === submitting) rt.submitting = null;
      finishSubmission();
    }
  }
  function removeUser(rt, ev) {
    rt.pendingUser = rt.pendingUser.filter((p) => p !== ev);
    rt.events = rt.events.filter((p) => p !== ev);
    dirty.delete(ev);
    ev.el?.remove();
  }
  async function stop(rt) {
    if (!rt || rt.stopping || (!rt.running && !rt.submitting)) return;
    const version = rt.processVersion;
    rt.stopping = true;
    setStatusText(rt, 'Stopping…');
    updateSendBtn();
    try {
      // Main-process image validation can still start/queue the prompt. Abort
      // only after its admission result, never an earlier, unrelated run.
      if (rt.submitting) await rt.submitting;
      if (version !== rt.processVersion) return;
      const q = await rpc(rt, { type: 'clear_queue' });
      for (const wire of [...(q?.steering || []), ...(q?.followUp || [])]) {
        const decoded = attachments.decodeUserContent(wire);
        const p = rt.pendingUser.find((p) => decoded.clientId ? p.clientId === decoded.clientId : p.wire === wire);
        const snapshot = p?.submission || decoded;
        if (p) removeUser(rt, p);
        composer.recover(sessionDraftKey(rt), snapshot);
      }
      if (version === rt.processVersion) await rpc(rt, { type: 'abort' });
    } catch (err) { if (version === rt.processVersion) fail(err); }
    finally { rt.stopping = false; if (isCur(rt)) refreshChrome(); }
  }
  function clearInput() { const d = composer.current(); if (d) composer.clear(d); acClose(); }

  async function createSession(firstPrompt, draft) {
    const cowork = document.body.dataset.mode === 'chat';
    const meta = await call('sessions:create', {
      kind: cowork ? 'cowork' : 'code',
      projectPath: cowork ? state.coworkFolder || null : state.project,
      worktree: !cowork && state.worktree,
      title: firstPrompt.replace(/@\S+/g, '').trim().slice(0, 60) || 'New session',
      autoName: true,
      model: state.model,
      thinking: state.effort,
      mode: state.mode,
      outputStyle: state.outputStyle,
    });
    const rt = runtime(meta);
    rt.loaded = true;
    rt.model = state.model;
    const active = !draft || composer.isActive(draft);
    if (draft) composer.rekey(draft, sessionDraftKey(rt));
    if (active) await openSession(meta.id, true);
    else renderSessions();
    return rt;
  }

  /* ================= 视图 ================= */
  function showWelcome() {
    fileRequest++;
    if (curRt()?.bottom?.loading) curRt().bottom = null;
    state.cur = null;
    $('#repoBtn svg').outerHTML = LAPTOP;
    document.body.dataset.view = 'welcome';
    const mode = document.body.dataset.mode;
    state.lastByMode[mode] = null;
    if (mode === 'chat') return showCoworkWelcome();
    $('#codeWelcome').hidden = false; $('#codeThread').hidden = true;
    $('#codeWelcomeSlot').appendChild(codeComposer);
    composer.activate(welcomeDraftKey());
    $('.ch').classList.add('is-new');
    codeMain.classList.remove('rc-open');
    workspace.reset();
    showMode(state.mode);
    renderModelButtons();
    renderSessions(); renderPrBar(); renderProjects(); updateSendBtn(); refreshImportable();
    $('#clawd').classList.remove('busy');
    codeInput.focus();
  }

  async function openSession(id, fresh) {
    fileRequest++;
    if (curRt()?.bottom?.loading) curRt().bottom = null;
    state.cur = id;
    const rt = state.rts.get(id);
    rt.unread = false;
    const mode = isCowork(rt) ? 'chat' : 'code';
    document.body.dataset.mode = mode;
    store.set('cc_mode', mode);
    document.body.dataset.view = 'thread';
    state.lastByMode[mode] = id;
    $('#codeWelcome').hidden = true; $('#codeThread').hidden = false;
    $('#codeThreadSlot').appendChild(codeComposer);
    composer.activate(sessionDraftKey(rt));
    $('.ch').classList.remove('is-new');
    renderThread();
    refreshChrome();
    app.classList.remove('mobile-open');
    codeInput.focus();
    if (rt.loaded && !fresh) { pollPr(rt); return; }
    try {
      const r = await call('sessions:open', id);
      rt.meta = r.meta;
      if (!fresh) replay(rt, r.messages);
      rt.loaded = true;
      rt.running = !!r.state?.isStreaming;
      rt.model = r.state?.model ? `${r.state.model.provider}/${r.state.model.id}` : null;
      rt.thinking = r.state?.thinkingLevel;
      rt.ctxPct = r.stats?.contextUsage?.percent ?? null;
      if (isCur(rt)) { renderThread(); refreshChrome(); }
      rpc(rt, { type: 'get_commands' }).then((c) => (rt.commands = (c.commands || []).filter((x) => !['desktop-mode', 'desktop-output-style'].includes(x.name)))).catch(() => {});
      rpc(rt, { type: 'get_available_thinking_levels' }).then((l) => { rt.levels = l.levels; if (isCur(rt)) renderModelButtons(); }).catch(() => {});
      loadChanges(rt);
      pollPr(rt);
    } catch (err) {
      push(rt, { type: 'note', level: 'error', text: `无法打开会话：${String(err.message || err)}` });
    }
  }

  function refreshChrome() {
    renderSessions();
    const rt = curRt();
    if (!rt) return;
    $('#sessName').textContent = rt.meta.title;
    $('#sessRepo').textContent = isCowork(rt)
      ? (rt.meta.scratch ? 'Temporary workspace' : projName(rt.meta.projectPath))
      : projName(rt.meta.projectPath) + (rt.meta.branch ? ` · ${rt.meta.branch}` : '');
    $('#sessEnv').innerHTML = isCowork(rt) ? I.folder : I.laptop;
    $('#repoBtn svg').outerHTML = isCowork(rt) ? I.folder : LAPTOP;
    showMode(rt.meta.mode || 'auto');
    renderSessMenu();
    renderModelButtons();
    renderPrBar(); renderRight(); updateStatus(); updateSendBtn(); renderProjects();
  }

  function updateSendBtn() {
    const rt = curRt();
    const d = composer.current();
    const ready = !!(d?.text.trim() || d?.attachments.length);
    const stopMode = rt?.running && !ready;
    codeSend.disabled = !!(d?.sending || d?.preparing || rt?.stopping);
    $('#sendBtn').disabled = !ready || !!(d?.sending || d?.preparing || rt?.stopping);
    codeSend.classList.toggle('stop', !!stopMode);
    codeSend.classList.toggle('ready', ready);
    codeSend.title = stopMode ? 'Stop (Esc)' : 'Send (↵)';
    const mod = state.info?.platform === 'darwin' ? '⌘' : 'Ctrl+';
    codeInput.placeholder = rt?.running ? `↵ to send, ${mod}↵ to queue for later` : rt ? (isCowork(rt) ? 'Reply to Claude, or type / for commands' : 'Type / for commands') : 'Describe a task or ask a question';
    $('#clawd').classList.toggle('busy', !!rt?.running);
  }

  /* ---------- 侧边栏 ---------- */
  const ago = (t, long) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return long ? `${m} minute${m > 1 ? 's' : ''} ago` : `${m}m`;
    if (m < 1440) { const h = Math.round(m / 60); return long ? `${h} hour${h > 1 ? 's' : ''} ago` : `${h}h`; }
    const d = Math.round(m / 1440); return long ? `${d} day${d > 1 ? 's' : ''} ago` : `${d}d`;
  };
  function sessIcon(rt) {
    if (rt.perm) return '<span class="si wait"></span>';
    if (rt.running) return '<span class="si run"></span>';
    if (rt.unread) return '<span class="si unread"></span>';
    if (rt.pr) return `<span class="si pr${rt.pr.state === 'merged' ? ' merged' : ''}">${rt.pr.state === 'merged' ? I.merged : I.pr}</span>`;
    return '';
  }
  const expanded = new Set();
  function renderSessions() {
    const groups = new Map();
    for (const p of state.projects) groups.set(p.path, []);
    [...state.rts.values()].filter((rt) => !rt.meta.archived && !isCowork(rt))
      .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))
      .forEach((rt) => {
        const key = rt.meta.projectPath;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rt);
      });
    const box = $('#sessionGroups');
    box.innerHTML = '';
    for (const [projectPath, list] of groups) {
      const g = document.createElement('div');
      g.className = 'cn-group';
      g.innerHTML = `<div class="cn-gh" title="${esc(projectPath)}"><span class="gname">${esc(projName(projectPath))}</span><button class="ic-btn" data-a="new" title="New session in ${esc(projName(projectPath))}">${I.plus}</button></div>`;
      g.querySelector('[data-a=new]').onclick = () => { selectProject(projectPath); showWelcome(); };
      const LIMIT = 5;
      const more = list.length > LIMIT && !expanded.has(projectPath) && !list.slice(LIMIT).some(isCur);
      (more ? list.slice(0, LIMIT) : list).forEach((rt) => {
        const it = document.createElement('div');
        it.className = 'cn-s' + (isCur(rt) ? ' active' : '');
        it.innerHTML = `${sessIcon(rt)}<span class="t${rt.unread ? ' unread' : ''}"></span>`;
        it.querySelector('.t').textContent = rt.meta.title;
        it.title = rt.perm ? 'Waiting for your approval' : rt.running ? 'Working…' : `${rt.meta.title} · ${ago(rt.meta.updatedAt || Date.now(), true)}`;
        it.onclick = () => openSession(rt.meta.id);
        g.appendChild(it);
      });
      if (more) {
        const m = document.createElement('button');
        m.className = 'cn-showmore';
        m.textContent = 'Show more';
        m.onclick = () => { expanded.add(projectPath); renderSessions(); };
        g.appendChild(m);
      }
      box.appendChild(g);
    }
    renderTasks();
  }
  $('#newSession').onclick = showWelcome;
  $('#newChat').onclick = showWelcome;
  $('#customizeBtn').onclick = () => toast('Customize：在 ~/.pi/agent 下管理扩展、技能和提示模板');
  $('#routinesBtn').onclick = () => toast('Routines 即将推出');
  $('#sbSearch').onclick = () => openPalette();
  $('#moreBtn').onclick = () => { $('#moreList').hidden = !$('#moreList').hidden; };
  document.querySelectorAll('#moreList [data-toast]').forEach((b) => (b.onclick = () => toast(`${b.dataset.toast}：即将推出`)));

  /* ---------- 项目 ---------- */
  function selectProject(p) {
    state.project = p;
    if (!curRt()) composer.activate(welcomeDraftKey());
    store.set('pd_project', p);
    renderProjects();
    refreshImportable();
  }
  const LAPTOP = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="4.5" width="13" height="8.5" rx="1.5"/><path d="M2 15.5h16"/></svg>';
  function renderProjects() {
    const rows = state.projects.map((p) => `<button class="proj-row${p.path === state.project ? ' on' : ''}" data-v="${esc(p.path)}" title="${esc(p.path)}">${LAPTOP}<span>${esc(p.name)}</span>${p.path === state.project ? I.check : ''}</button>`).join('');
    const add = '<button class="proj-row" data-add>' + I.plus + '<span>Open folder…</span></button>';
    $('#projList').innerHTML = rows + add;
    $('#repoMenu').innerHTML = '<div class="pop-label">Project</div>' + rows + '<div class="menu-sep"></div>' + add;
    document.querySelectorAll('.proj-row').forEach((b) => (b.onclick = async () => {
      closePops();
      if (b.dataset.add !== undefined) {
        const p = await call('projects:add').catch(fail);
        if (!p) return;
        state.projects = await call('projects:list');
        selectProject(p.path);
        renderSessions();
        return;
      }
      selectProject(b.dataset.v);
      codeInput.focus();
    }));
    const rt = curRt();
    $('#repoName').textContent = rt ? (rt.meta.scratch ? 'Temporary workspace' : projName(rt.meta.projectPath)) : state.project ? projName(state.project) : 'Choose a project';
    $('#worktreeChk').checked = state.worktree;
  }
  $('#repoBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const rt = curRt();
    if (rt) return isCowork(rt) ? call('sessions:openPath', rt.meta.id, '.', false).catch(fail) : toast(rt.meta.cwd);
    openPop('#repoMenu');
  });
  $('#worktreeChk').onchange = (e) => { state.worktree = e.target.checked; store.set('pd_worktree', state.worktree); };

  async function refreshImportable() {
    if (!state.project) { $('#importBtn').hidden = true; return; }
    state.importable = await call('sessions:importable', state.project).catch(() => []);
    const n = state.importable.length;
    $('#importBtn').hidden = false;
    $('#importBtn').disabled = !n;
    $('#importLabel').textContent = n ? `Import ${n} pi CLI session${n > 1 ? 's' : ''}` : 'No pi CLI sessions to import';
  }
  $('#importBtn').onclick = async () => {
    const list = state.importable;
    if (!list.length) return;
    const pick = list.length === 1 ? list[0] : await chooseModal('Import a pi CLI session', list.map((s) => `${s.name || s.firstPrompt?.slice(0, 60) || s.id} · ${ago(s.mtime)}`)).then((i) => list[i]);
    if (!pick) return;
    try {
      const meta = await call('sessions:import', pick.file);
      runtime(meta);
      await openSession(meta.id);
      refreshImportable();
      toast('Imported session');
    } catch (err) { fail(err); }
  };

  /* ---------- 模式 / 模型 / 思考强度 ---------- */
  function showMode(id) {
    const m = MODES.find((x) => x.id === id) || MODES[0];
    $('#permBtn').dataset.m = m.id;
    $('#permName').textContent = m.name;
    $('#permMenu').querySelectorAll('.opt').forEach((o) => o.classList.toggle('active', o.dataset.v === m.id));
  }

  function applyViewMode() {
    for (const rt of state.rts.values()) {
      rt.events.forEach((e) => {
        if (e.type !== 'group') return;
        if (!e.userToggled) e.open = state.viewMode === 'verbose';
        (e.steps || []).forEach((s) => {
          if (s.kind === 'think' && !s.userToggled) s.open = state.viewMode === 'verbose';
        });
      });
    }
  }
  function setViewMode(id, announce) {
    if (!VIEW_MODES.some((m) => m.id === id)) return;
    state.viewMode = id;
    store.set('pd_view_mode', id);
    applyViewMode();
    const rt = curRt();
    if (rt) {
      const top = msgsEl.scrollTop, stick = nearBottom();
      renderThread();
      if (!stick) msgsEl.scrollTop = top;
    }
    renderSessMenu();
    if (announce) toast(`Transcript view: ${VIEW_MODES.find((m) => m.id === id).name}`);
  }
  function cycleViewMode() {
    const rt = curRt();
    const modes = VIEW_MODES.filter((m) => m.id !== 'thinking' || hasThinking(rt));
    const at = modes.findIndex((m) => m.id === state.viewMode);
    setViewMode((modes[at + 1] || modes[0]).id, true);
  }
  async function setOutputStyle(id, announce) {
    if (!OUTPUT_STYLES.some((s) => s.id === id)) return;
    state.outputStyle = id;
    store.set('pd_output_style', id);
    const rt = curRt();
    if (rt) {
      rt.meta.outputStyle = id;
      call('sessions:style', rt.meta.id, id).catch(fail);
    }
    renderSessMenu();
    if (announce) toast(`Output style: ${OUTPUT_STYLES.find((s) => s.id === id).name}`);
  }
  async function setPermMode(id, announce) {
    const rt = curRt();
    if (rt) {
      rt.meta.mode = id;
      call('sessions:mode', rt.meta.id, id).catch(fail);
    } else {
      state.mode = id;
      store.set('pd_mode', id);
    }
    showMode(id);
    if (announce) toast(`Mode: ${MODES.find((m) => m.id === id).name}`);
  }
  $('#permMenu').innerHTML = '<div class="pop-label">Mode · ⇧Tab to cycle</div>' + MODES.map((m) =>
    `<button class="menu-item opt" data-v="${m.id}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('');
  $('#permMenu').querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => { setPermMode(o.dataset.v); closePops(); }));
  $('#permBtn').addEventListener('click', (e) => { e.stopPropagation(); openPop('#permMenu'); });

  const modelName = (id) => {
    const m = state.models.find((x) => `${x.provider}/${x.id}` === id);
    return m ? m.name || m.id : id ? id.split('/').pop() : 'No model';
  };
  function renderModelButtons() {
    const rt = curRt();
    const model = rt ? rt.model : state.model;
    $('#codeModelName').textContent = modelName(model);
    const levels = (rt ? rt.levels : state.levels) || [];
    const effort = rt ? rt.thinking : state.effort;
    $('#effortBtn').hidden = !levels.length || (levels.length === 1 && levels[0] === 'off');
    $('#effortName').textContent = LEVEL_LABEL[effort] || effort || '';
    const byProvider = new Map();
    state.models.forEach((m) => { if (!byProvider.has(m.provider)) byProvider.set(m.provider, []); byProvider.get(m.provider).push(m); });
    $('#codeModelMenu').innerHTML = [...byProvider].map(([p, list]) => `<div class="pop-label">${esc(p)}</div>` + list.map((m) => {
      const id = `${m.provider}/${m.id}`;
      return `<button class="menu-item opt${id === model ? ' active' : ''}" data-v="${esc(id)}"><b>${esc(m.name || m.id)}</b><small>${m.contextWindow ? `${fmtTok(m.contextWindow)} context` : ''}${m.reasoning ? ' · reasoning' : ''}</small></button>`;
    }).join('')).join('') + '<div class="menu-sep"></div><button class="menu-item" data-keys>Add API key…</button>';
    $('#codeModelMenu').querySelectorAll('.opt').forEach((o) => (o.onclick = () => { closePops(); chooseModel(o.dataset.v); }));
    $('#codeModelMenu').querySelector('[data-keys]').onclick = () => { closePops(); keysModal(); };
    $('#effortMenu').innerHTML = '<div class="pop-label">Thinking effort</div>' + levels.map((l) =>
      `<button class="menu-item opt${l === effort ? ' active' : ''}" data-v="${l}"><b>${LEVEL_LABEL[l] || l}</b></button>`).join('');
    $('#effortMenu').querySelectorAll('.opt').forEach((o) => (o.onclick = () => { closePops(); chooseEffort(o.dataset.v); }));
    renderCoworkModel(byProvider, model, levels, effort);
    document.querySelectorAll('#codeModelMenu.open, #modelMenu.open').forEach((menu) => fitModelMenu(menu, true));
  }
  async function chooseModel(id) {
    const rt = curRt();
    const [provider, ...rest] = id.split('/');
    if (rt) {
      try {
        await rpc(rt, { type: 'set_model', provider, modelId: rest.join('/') });
        rt.model = id;
        rt.levels = (await rpc(rt, { type: 'get_available_thinking_levels' })).levels;
        if (!rt.levels.includes(rt.thinking)) rt.thinking = rt.levels.at(-1);
      } catch (err) { return fail(err); }
    } else {
      state.model = id;
      store.set('pd_model', id);
      state.levels = await call('models:levels', id).catch(() => []);
    }
    renderModelButtons();
  }
  async function chooseEffort(level) {
    const rt = curRt();
    if (rt) {
      try { await rpc(rt, { type: 'set_thinking_level', level }); rt.thinking = level; } catch (err) { return fail(err); }
    } else {
      state.effort = level;
      store.set('pd_effort', level);
    }
    renderModelButtons();
  }
  $('#codeModelBtn').addEventListener('click', (e) => { e.stopPropagation(); openPop('#codeModelMenu'); });
  $('#effortBtn').addEventListener('click', (e) => { e.stopPropagation(); openPop('#effortMenu'); });
  async function loadModels() {
    try {
      const { models, defaultModel } = await call('models:list');
      state.models = models;
      const ids = models.map((m) => `${m.provider}/${m.id}`);
      if (!state.model || !ids.includes(state.model)) {
        // Prefer a real model when one is configured; otherwise the offline demo model.
        const real = ids.find((i) => !i.startsWith('demo/'));
        state.model = state.info.demo ? 'demo/demo-coder' : defaultModel && !defaultModel.startsWith('demo/') ? defaultModel : real || 'demo/demo-coder';
      }
      state.levels = await call('models:levels', state.model).catch(() => []);
      renderModelButtons();
    } catch (err) {
      fail(err);
    }
  }
  $('#ctxRing').onclick = () => toast(`${$('#ctxRing').title} · /compact 可以压缩`);

  /* ---------- PR 条 ---------- */
  function renderPrBar() {
    const bar = $('#prBar');
    const rt = curRt();
    const ch = rt ? rt.changes : [];
    if (!rt || isCowork(rt) || rt.prHidden || !rt.meta.branch || (!ch.length && !rt.pr)) { bar.hidden = true; return; }
    bar.hidden = false;
    const add = ch.reduce((a, f) => a + f.add, 0), del = ch.reduce((a, f) => a + f.del, 0);
    const stat = `<span class="chip-s"><span class="plus">+${add}</span><span class="minus">−${del}</span></span>`;
    if (!rt.pr) {
      bar.innerHTML = `<span class="pr-ic draft">${I.branch}</span><span class="pr-repo" title="${esc(rt.meta.projectPath)}">${esc(projName(rt.meta.projectPath))}</span><span class="pr-br" title="${esc(rt.meta.branch)}">${esc(rt.meta.branch)}</span>${stat}
        <button class="pr-create" ${rt.running ? 'disabled style="opacity:.5"' : ''}>Create PR</button>`;
      bar.querySelector('.pr-create').onclick = () => {
        if (rt.running) return;
        codeInput.value = `提交当前所有改动（写一个清晰的 commit message），把分支 ${rt.meta.branch} 推送到 origin，然后用 gh pr create 创建 PR，最后告诉我 PR 链接。`;
        send(false);
      };
      return;
    }
    const pr = rt.pr;
    const status = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
    const statusLabel = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' }[status];
    bar.innerHTML = `<button class="pr-link" data-a="open" title="${esc(pr.url)}"><span class="pr-ic ${status}">${pr.state === 'merged' ? I.merged : I.pr}</span><span class="pr-num">#${pr.num}</span></button><span class="pr-repo" title="${esc(rt.meta.projectPath)} · ${esc(rt.meta.branch)}">${esc(projName(rt.meta.projectPath))}</span><span class="pr-spacer"></span>${stat}
      ${pr.comments ? `<button class="chip-s" data-a="cm" title="Review comments">${I.comment}${pr.comments}</button>` : ''}
      <button class="pr-state ${status}" data-a="open" title="${statusLabel} · ${esc(pr.url)}">${statusLabel}</button>
      ${pr.checks?.length ? `<div class="pop-wrap"><button class="chip-s ui" data-a="ci"><span class="dot ${pr.ci}"></span>CI ${I.cvd}</button>
        <div class="pop pop-up pop-right ci-pop" id="ciPop"><div class="pop-label">Checks · ${pr.ci === 'pending' ? 'running' : pr.ci === 'pass' ? 'all passed' : 'failing'}</div>
        ${pr.checks.map((c) => `<div class="ci-row"><span class="dot ${c.st}"></span>${esc(c.n)}</div>`).join('')}
        <div class="menu-sep"></div>
        <button class="menu-item" data-a="watch">盯着 CI，失败就自动修</button>
        <button class="menu-item" data-a="open">Open on GitHub</button></div></div>` : ''}
      <button class="ic-btn sm" data-a="x" title="Hide">${I.close}</button>`;
    bar.querySelector('[data-a=ci]')?.addEventListener('click', (e) => { e.stopPropagation(); openPop('#ciPop'); });
    bar.querySelector('[data-a=x]').onclick = () => { rt.prHidden = true; renderPrBar(); };
    bar.querySelectorAll('[data-a=open]').forEach((b) => (b.onclick = () => { closePops(); call('app:openExternal', pr.url); }));
    bar.querySelector('[data-a=watch]')?.addEventListener('click', () => {
      closePops();
      codeInput.value = `用 gh pr checks ${pr.num} --watch 盯着 PR #${pr.num} 的 CI；如果有检查失败，读取失败日志、修复、提交并推送，直到全部通过。`;
      autosize(); updateSendBtn(); codeInput.focus();
    });
    bar.querySelector('[data-a=cm]')?.addEventListener('click', () => {
      codeInput.value = `用 gh pr view ${pr.num} --comments 读取 PR #${pr.num} 的评审意见，逐条处理后提交并推送。`;
      autosize(); updateSendBtn(); codeInput.focus();
    });
  }

  /* ---------- 右侧卡片 ---------- */
  function renderRight() {
    const rt = curRt();
    if (isCowork(rt)) {
      codeMain.classList.toggle('rc-open', rt.panelOpen || !!rt.bottom);
      $('#panelBtn').classList.toggle('on', rt.panelOpen);
      $('#diffCard').hidden = true;
      $('#previewCard').hidden = true;
      $('#filesCard').hidden = true;
      $('#terminalCard').hidden = true;
      coworkCard.hidden = !rt.panelOpen;
      if (rt.panelOpen) renderCoworkPanel(rt);
      renderBottom(rt);
      workspace.sync();
      return;
    }
    coworkCard.hidden = true;
    const open = !!rt && (rt.diffOpen || rt.previewOpen || rt.filesOpen || rt.terminalOpen || !!rt.bottom);
    codeMain.classList.toggle('rc-open', open);
    codeMain.classList.remove('rc-wide');
    $('#diffBtn').classList.toggle('on', !!rt?.diffOpen);
    $('#termBtn').classList.toggle('on', !!rt?.terminalOpen);
    $('#previewBtn').classList.toggle('on', !!rt?.previewOpen);
    $('#filesBtn').classList.toggle('on', !!rt?.filesOpen);
    if (!rt) {
      $('#diffCard').hidden = true;
      $('#previewCard').hidden = true;
      $('#filesCard').hidden = true;
      $('#terminalCard').hidden = true;
      renderBottom(null);
      workspace.sync();
      return;
    }
    $('#diffCard').hidden = !rt.diffOpen;
    if (rt.diffOpen) renderDiff(rt);
    $('#previewCard').hidden = !rt.previewOpen;
    if (rt.previewOpen) renderPreview(rt);
    $('#filesCard').hidden = !rt.filesOpen;
    if (rt.filesOpen) renderFiles(rt);
    $('#terminalCard').hidden = !rt.terminalOpen;
    if (rt.terminalOpen) renderTerminal(rt);
    renderBottom(rt);
    workspace.sync();
  }
  function renderDiff(rt) {
    $('#diffBase').textContent = rt.meta.baseBranch || 'base';
    $('#diffHead').textContent = rt.meta.branch || projName(rt.meta.cwd);
    const ch = rt.changes;
    const body = $('#diffBody');
    const top = body.scrollTop;
    if (!rt.meta.baseCommit) { body.innerHTML = '<div class="diff-empty">这个项目不是 git 仓库<br>初始化 git 后即可查看 Claude 的改动</div>'; return; }
    if (!ch.length) { body.innerHTML = '<div class="diff-empty">No changes yet<br>Claude 修改的文件会出现在这里</div>'; return; }
    body.innerHTML = ch.map((f) => `<div class="df${rt.collapsed.has(f.path) ? ' collapsed' : ''}" data-p="${esc(f.path)}">
        <div class="df-h">${I.cvd}<span class="ftag">${I.code}</span>${esc(fname(f.path))}<span class="dir">${esc(fdir(f.path))}</span>
          ${f.status === 'A' ? '<span class="new">NEW</span>' : f.status === 'D' ? '<span class="new" style="color:var(--red)">DELETED</span>' : ''}<span class="plus">+${f.add}</span><span class="minus">−${f.del}</span></div>
        <div class="df-rows">${f.binary ? '<div class="gap">Binary or large file</div>' : diffRows(f.before, f.status === 'D' ? null : f.after, f.path, rt.openGaps)}</div></div>`).join('');
    body.scrollTop = top;
    body.querySelectorAll('.df-h').forEach((h) => (h.onclick = () => {
      const p = h.parentElement.dataset.p;
      rt.collapsed.has(p) ? rt.collapsed.delete(p) : rt.collapsed.add(p);
      h.parentElement.classList.toggle('collapsed');
    }));
    body.querySelectorAll('.gap[data-gap]').forEach((g) => (g.onclick = () => { rt.openGaps.add(g.dataset.gap); renderDiff(rt); }));
    $('#fileListMenu').innerHTML = '<div class="pop-label">Changed files</div>' + ch.map((f) =>
      `<button class="menu-item" data-p="${esc(f.path)}">${esc(f.path)}<span class="st"><span class="plus">+${f.add}</span> <span class="minus">−${f.del}</span></span></button>`).join('');
    $('#fileListMenu').querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { closePops(); scrollToFile(b.dataset.p); }));
  }
  function scrollToFile(p) {
    const el = [...document.querySelectorAll('#diffBody .df')].find((x) => x.dataset.p === p || p.endsWith('/' + x.dataset.p) || x.dataset.p.endsWith(p));
    if (!el) return false;
    $('#diffBody').scrollTop = el.offsetTop - 4;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 900);
    return true;
  }
  function relPath(rt, p) {
    const cwd = rt.meta.cwd.replace(/\\/g, '/');
    const q = String(p).replace(/\\/g, '/');
    return q.startsWith(cwd + '/') ? q.slice(cwd.length + 1) : q.replace(/^\.\//, '');
  }
  let fileRequest = 0;
  function openDiffRef(rt, path) {
    if (!isCur(rt)) return;
    const rel = relPath(rt, path);
    rt.diffOpen = true; rt.collapsed.delete(rel);
    renderRight();
    if (!scrollToFile(rel)) loadChanges(rt).then(() => { if (isCur(rt)) scrollToFile(rel); });
  }
  async function openFileRef(p, line, rt = curRt()) {
    if (!rt || !isCur(rt)) return;
    const rel = relPath(rt, p), request = ++fileRequest;
    const pending = { type: 'file', path: rel, line: previews.positiveLine(line), loading: true };
    openBottom(rt, pending);
    try {
      const text = await call('sessions:readFile', rt.meta.id, rel);
      if (request !== fileRequest || !isCur(rt) || rt.bottom !== pending) return;
      pending.loading = false;
      pending.text = text;
      renderBottom(rt);
    } catch (err) {
      if (request !== fileRequest || !isCur(rt) || rt.bottom !== pending) return;
      pending.loading = false;
      pending.error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      renderBottom(rt);
    }
  }
  $('#diffBtn').onclick = () => { const rt = curRt(); if (!rt) return; rt.diffOpen = !rt.diffOpen; if (rt.diffOpen) loadChanges(rt); renderRight(); };
  $('#diffCard .card-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const rt = curRt();
    ({
      search: () => {
        rt.filesOpen = true; rt.fileFilter = '';
        if (!rt.files) call('sessions:files', rt.meta.id).then((files) => { rt.files = files; if (isCur(rt)) renderRight(); }).catch(fail);
        renderRight(); $('#filesFilter').focus();
      },
      more: () => { rt.openGaps.clear(); rt.collapsed.clear(); loadChanges(rt); toast('Refreshed'); },
      pop: () => call('sessions:openIn', rt.meta.id, 'vscode'),
      expand: () => workspace.expand($('#diffCard')),
      close: () => { rt.diffOpen = false; workspace.reset(); renderRight(); },
    })[b.dataset.t]();
  });
  $('#fileListBtn').onclick = (e) => { e.stopPropagation(); openPop('#fileListMenu'); };

  function openBottom(rt, b, force) {
    rt.bottom = b;
    renderRight();
  }
  function renderBottom(rt) {
    const card = $('#bottomCard'), head = $('#bottomHead'), body = $('#bottomBody');
    const b = rt?.bottom;
    card.hidden = !b;
    body.classList.toggle('file-viewer', b?.type === 'file');
    if (!b) { body._file = null; return; }
    if (b.type !== 'file') body._file = null;
    const close = `<button class="ic-btn sm" data-x title="Close">${I.close}</button>`;
    const expand = `<button class="ic-btn sm" data-e title="Expand">${I.expand}</button>`;
    if (b.type === 'plan') {
      head.innerHTML = `<span class="ttl">Plan</span><div class="card-tools"><button class="ic-btn sm" data-c title="Copy">${I.copy}</button>${expand}${close}</div>`;
      body.innerHTML = `<div class="bc-pad"><div class="bc-note">${I.comment}Review the plan. Approve it to let Claude start, or keep planning and reply with changes.</div>
        <div class="e-text" style="margin:0">${renderMarkdown(b.ev.md || '')}</div>
        ${b.ev.reqId && !b.ev.resolved ? `<div style="margin-top:16px">${planActions()}</div>` : ''}</div>`;
      body.querySelectorAll('[data-a]').forEach((x) => (x.onclick = () => answerUi(rt, b.ev, { value: x.dataset.a }, x.dataset.a)));
      head.querySelector('[data-c]').onclick = () => navigator.clipboard.writeText(b.ev.md || '').then(() => toast('Plan copied'));
    } else if (b.type === 'agent') {
      const t = b.tool;
      head.innerHTML = `<button class="ic-btn sm" data-x title="Back">${I.back}</button><span class="ttl">${esc(t.desc)}</span><div class="card-tools">${expand}${close}</div>`;
      body.innerHTML = `<div class="bc-pad"><div class="bc-prompt">${esc(t.prompt || '')}</div>
        ${t.status === 'running' ? `<div class="bc-meta"><span class="shimmer">${esc(t.summary || 'Working…')}</span></div>` : `<div class="bc-meta">${esc(t.summary || '')}</div><div class="e-text" style="margin:0">${renderMarkdown(t.md || '')}</div>`}</div>`;
      linkify(body);
    } else if (b.type === 'file') {
      const hasDiff = rt.changes.some((f) => f.path === b.path);
      head.innerHTML = `<span class="ttl" title="${esc(b.path)}"><span class="mono">${esc(b.path)}</span></span><div class="card-tools">${hasDiff ? '<button class="file-diff-btn" data-diff>Diff</button>' : ''}${expand}${close}</div>`;
      const same = body._file === b && body._fileStart === b.start && body._fileLoading === b.loading;
      const top = same ? body.scrollTop : 0, left = same ? body.scrollLeft : 0;
      if (!same) {
        if (b.loading) body.innerHTML = '<div class="diff-empty">Loading current file…</div>';
        else if (b.error) body.innerHTML = `<div class="file-read-error">Unable to open current file.<pre>${esc(b.error)}</pre></div>`;
        else if (b.text == null) body.innerHTML = '<div class="diff-empty">File preview unavailable<br>Binary, non-text, or larger than 1 MiB</div>';
        else {
          const view = previews.lineWindow(b.text, b.line, b.start);
          const nav = `<div class="file-window"><button data-prev${view.previous == null ? ' disabled' : ''}>Previous lines</button><span>Lines ${view.startLine}–${view.endLine} of ${view.totalLines}</span><button data-next${view.next == null ? ' disabled' : ''}>Next lines</button></div>`;
          body.innerHTML = `${nav}${b.line > view.totalLines ? `<div class="tool-preview-note">Requested line ${b.line} is beyond the current file (${view.totalLines} lines). Showing the last line.</div>` : ''}${codeLines(view.lines, b.path, view.targetLine, view.startLine, previews.WINDOW_LINES, true)}${nav}`;
          for (const [key, start] of [['prev', view.previous], ['next', view.next]]) body.querySelectorAll(`[data-${key}]`).forEach((button) => button.onclick = () => { if (start != null && isCur(rt) && rt.bottom === b) { b.start = start; renderBottom(rt); } });
        }
        body._file = b; body._fileStart = b.start; body._fileLoading = b.loading;
      }
      head.querySelector('[data-diff]')?.addEventListener('click', () => openDiffRef(rt, b.path));
      if (same) { body.scrollTop = top; body.scrollLeft = left; }
      else {
        const target = body.querySelector('.target-line');
        body.scrollTop = target ? target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 65 : 0;
        body.scrollLeft = 0;
      }
    }
    head.querySelector('[data-x]').onclick = () => { rt.bottom = null; renderRight(); };
    head.querySelector('[data-e]')?.addEventListener('click', () => workspace.expand(card));
  }
  $('#termBtn').onclick = () => { const rt = curRt(); if (!rt) return toast('先开始一个会话'); rt.terminalOpen = !rt.terminalOpen; renderRight(); };
  $('#previewBtn').onclick = () => { const rt = curRt(); if (!rt) return toast('先开始一个会话'); rt.previewOpen = !rt.previewOpen; renderRight(); };
  $('#filesBtn').onclick = () => { const rt = curRt(); if (!rt) return toast('先开始一个会话'); rt.filesOpen = !rt.filesOpen; if (rt.filesOpen && !rt.files) call('sessions:files', rt.meta.id).then((files) => { rt.files = files; if (isCur(rt)) renderRight(); }).catch(fail); renderRight(); };
  $('#filesFilter').addEventListener('input', () => { const rt = curRt(); if (!rt) return; rt.fileFilter = $('#filesFilter').value; renderFiles(rt); });

  function renderPreview(rt) {
    const card = $('#previewCard'), head = $('#previewHead'), body = $('#previewBody');
    const url = rt.previewUrl || store.get('pd_preview', 'http://localhost:5173');
    head.innerHTML = `<form class="pv-form"><input value="${esc(url)}" aria-label="Preview URL" spellcheck="false"></form><div class="card-tools"><button class="ic-btn sm" data-r title="Reload">${I.reload}</button><button class="ic-btn sm" data-e title="Expand">${I.expand}</button><button class="ic-btn sm" data-x title="Close">${I.close}</button></div>`;
    const frame = body.querySelector('iframe') || document.createElement('iframe');
    frame.className = 'pv-iframe';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    if (!frame.isConnected) body.replaceChildren(frame);
    if (frame.dataset.url !== url) { frame.src = url; frame.dataset.url = url; }
    head.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      let u = head.querySelector('input').value.trim();
      if (!/^https?:\/\//.test(u)) u = 'http://' + u;
      if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)) return toast('预览只支持 localhost');
      rt.previewUrl = u; store.set('pd_preview', u); renderPreview(rt);
    };
    head.querySelector('[data-r]').onclick = () => { frame.src = url; };
    head.querySelector('[data-e]').onclick = () => workspace.expand(card);
    head.querySelector('[data-x]').onclick = () => { rt.previewOpen = false; renderRight(); };
  }

  function renderTerminal(rt) {
    const card = $('#terminalCard'), head = $('#terminalHead'), body = $('#terminalBody');
    head.innerHTML = `<span class="ttl">Terminal <span class="mono" style="color:var(--tx-3)">${esc(rt.meta.cwd)}</span></span><div class="card-tools"><button class="ic-btn sm" data-x title="Close">${I.close}</button></div>`;
    let output = body.querySelector('.term-b');
    let form = body.querySelector('.term-in');
    if (!output || !form || body.dataset.session !== rt.meta.id) {
      output = document.createElement('div'); output.className = 'term-b';
      form = document.createElement('form'); form.className = 'term-in';
      form.innerHTML = `<span>❯</span><input aria-label="Run a terminal command" placeholder="Run a command in ${esc(projName(rt.meta.cwd))}" spellcheck="false">`;
      body.replaceChildren(output, form);
      body.dataset.session = rt.meta.id;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const input = form.querySelector('input'), cmd = input.value.trim();
        if (!cmd) return;
        input.value = '';
        const entry = { cmd, out: '…' };
        rt.term.push(entry); renderTerminal(rt);
        try { const r = await rpc(rt, { type: 'bash', command: cmd }); entry.out = r.output + (r.exitCode ? `\nCommand exited with code ${r.exitCode}` : ''); }
        catch (err) { entry.out = String(err.message || err); }
        renderTerminal(rt); scheduleChanges(rt); body.querySelector('input')?.focus();
      };
    }
    output.innerHTML = rt.term.length ? rt.term.map((t) => `<span class="cmd">${esc(t.cmd)}</span>\n${colorOut(t.out)}\n`).join('\n') : '<span class="dim">Claude 运行的命令会显示在这里。也可以在下面输入命令，输出会加入对话上下文。</span>';
    body.scrollTop = body.scrollHeight;
    head.querySelector('[data-x]').onclick = () => { rt.terminalOpen = false; renderRight(); };
  }

  function renderFiles(rt) {
    const card = $('#filesCard'), head = $('#filesHead'), body = $('#filesBody');
    head.innerHTML = `<span class="ttl">Files</span><div class="card-tools"><button class="ic-btn sm" data-r title="Refresh">${I.reload}</button><button class="ic-btn sm" data-x title="Close">${I.close}</button></div>`;
    head.querySelector('[data-r]').onclick = async () => { rt.files = null; try { rt.files = await call('sessions:files', rt.meta.id); renderFiles(rt); } catch (err) { fail(err); } };
    head.querySelector('[data-x]').onclick = () => { rt.filesOpen = false; renderRight(); };
    $('#filesFilter').value = rt.fileFilter || '';
    if (!rt.files) { body.innerHTML = '<div class="diff-empty">Loading files…</div>'; return; }
    const q = (rt.fileFilter || '').toLowerCase();
    const tree = new Map();
    for (const path of rt.files.filter((p) => !q || p.toLowerCase().includes(q))) {
      const bits = path.split('/');
      for (let i = 1; i <= bits.length; i++) {
        const key = bits.slice(0, i).join('/');
        if (!tree.has(key)) tree.set(key, { path: key, name: bits[i - 1], depth: i - 1, folder: i < bits.length, children: [] });
        if (i > 1 && !tree.get(bits.slice(0, i - 1).join('/')).children.includes(key)) tree.get(bits.slice(0, i - 1).join('/')).children.push(key);
      }
    }
    const rows = [];
    const visit = (nodes) => {
      nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
      for (const node of nodes) {
        rows.push(node);
        if (node.folder && (q || rt.fileDirs.has(node.path))) visit(node.children.map((key) => tree.get(key)));
      }
    };
    visit([...tree.values()].filter((node) => !node.depth));
    body.innerHTML = rows.map((node) => {
      const expanded = !!q || rt.fileDirs.has(node.path);
      const icon = node.folder ? I.folder : I.file;
      return `<button class="file-tree-row" style="--depth:${node.depth}" data-p="${esc(node.path)}" data-folder="${node.folder}" ${node.folder ? `aria-expanded="${expanded}"` : ''} title="${esc(node.path)}">${node.folder ? I.cv : ''}${icon}<span>${esc(node.name)}</span></button>`;
    }).join('') || '<div class="diff-empty">No matching files</div>';
    body.querySelectorAll('[data-p]').forEach((button) => button.onclick = () => {
      if (button.dataset.folder === 'true') {
        const path = button.dataset.p;
        rt.fileDirs.has(path) ? rt.fileDirs.delete(path) : rt.fileDirs.add(path);
        renderFiles(rt);
      } else openFileRef(button.dataset.p);
    });
  }

  /* ---------- 头部菜单 ---------- */
  function renderSessMenu() {
    const rt = curRt();
    if (!rt) return;
    const style = rt.meta.outputStyle || state.outputStyle;
    const viewRows = VIEW_MODES.filter((m) => m.id !== 'thinking' || hasThinking(rt)).map((m) =>
      `<button class="menu-item pick${state.viewMode === m.id ? ' active' : ''}" data-view="${m.id}" title="${esc(m.desc)}">${esc(m.name)}</button>`).join('');
    const styleRows = OUTPUT_STYLES.map((s) =>
      `<button class="menu-item pick${style === s.id ? ' active' : ''}" data-style="${s.id}" title="${esc(s.desc)}">${esc(s.name)}</button>`).join('');
    const key = state.info?.platform === 'darwin' ? '⌘O' : 'Ctrl+O';
    $('#sessMenu').innerHTML = `<button class="menu-item" data-act="rename">Rename</button>
      <button class="menu-item" data-act="copy">Copy worktree path</button>
      <button class="menu-item" data-act="export">Export as HTML</button>
      <div class="menu-sep"></div>
      <div class="pop-label row"><span>Transcript view</span><kbd>${key}</kbd></div>
      ${viewRows}
      <div class="menu-sep"></div>
      <div class="pop-label">Output style</div>
      ${styleRows}
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-act="archive">Archive</button>`;
  }
  function positionSessMenu() {
    const menu = $('#sessMenu');
    if (!menu.classList.contains('open')) return;
    const btn = $('#sessNameBtn').getBoundingClientRect();
    const width = menu.offsetWidth || 210;
    const height = menu.offsetHeight || 0;
    const left = Math.min(Math.max(8, btn.left), Math.max(8, innerWidth - width - 8));
    const top = Math.min(btn.bottom + 6, Math.max(8, innerHeight - height - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }
  const toggleSessMenu = () => {
    renderSessMenu();
    openPop('#sessMenu');
    positionSessMenu();
  };
  $('#sessNameBtn').onclick = (e) => { e.stopPropagation(); toggleSessMenu(); };
  $('#sessMoreBtn').onclick = (e) => { e.stopPropagation(); toggleSessMenu(); };
  window.addEventListener('resize', positionSessMenu);
  $('#sessMenu').addEventListener('click', async (e) => {
    const vb = e.target.closest('button[data-view]');
    if (vb) { closePops(); setViewMode(vb.dataset.view, true); return; }
    const sb = e.target.closest('button[data-style]');
    if (sb) { closePops(); setOutputStyle(sb.dataset.style, true); return; }
    const b = e.target.closest('button[data-act]'); if (!b) return;
    closePops();
    const rt = curRt();
    if (!rt) return;
    const act = b.dataset.act;
    try {
      if (act === 'rename') {
        const t = await inputModal('Rename session', rt.meta.title);
        if (t) { rt.meta = await call('sessions:update', rt.meta.id, { title: t }); refreshChrome(); }
      }
      if (act === 'copy') { await navigator.clipboard.writeText(rt.meta.cwd); toast('Copied'); }
      if (act === 'export') toast(`Exported to ${(await rpc(rt, { type: 'export_html' })).path}`);
      if (act === 'archive') {
        await call('sessions:archive', rt.meta.id);
        rt.meta.archived = true;
        showWelcome();
        toast('Archived');
      }
    } catch (err) { fail(err); }
  });
  $('#openInBtn').onclick = (e) => { e.stopPropagation(); openPop('#openInMenu'); };
  $('#openInMenu').innerHTML = `<div class="pop-label">Open in</div>
    <button class="menu-item" data-app="vscode"><span class="app-ico" style="background:#2f80ed">VS</span>VS Code</button>
    <button class="menu-item" data-app="cursor"><span class="app-ico" style="background:#3a3a3a">Cu</span>Cursor</button>
    <button class="menu-item" data-app="terminal"><span class="app-ico" style="background:#444">&gt;_</span>Terminal</button>
    <button class="menu-item" data-app="folder"><span class="app-ico" style="background:#e3a21a">F</span>${state.info?.platform === 'darwin' ? 'Finder' : 'File Explorer'}</button>`;
  $('#openInMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-app]');
    if (!b) return;
    closePops();
    const rt = curRt();
    if (!rt) return toast('先开始一个会话');
    call('sessions:openIn', rt.meta.id, b.dataset.app).catch(fail);
  });

  /* ================= 弹窗 / 菜单 ================= */
  function fitModelMenu(menu, revealSelected = false) {
    if (!menu.matches('#codeModelMenu, #modelMenu')) return;
    // Both menus open upwards. Reserve the title bar and the gap above the trigger,
    // rather than a fixed vh limit (the Cowork trigger can be mid-window).
    const anchor = menu.parentElement.getBoundingClientRect();
    const bottom = anchor.bottom - parseFloat(getComputedStyle(menu).bottom);
    const top = $('.chrome').getBoundingClientRect().bottom + 8;
    menu.style.setProperty('--model-menu-max-height', `${Math.max(0, bottom - top)}px`);
    if (revealSelected) {
      const selected = menu.querySelector('.opt.active, .model-opt.active');
      // Scroll only the menu; scrollIntoView can also move the underlying page.
      menu.scrollTop = selected ? selected.offsetTop - (menu.clientHeight - selected.offsetHeight) / 2 : 0;
    }
  }
  window.addEventListener('resize', () => {
    document.querySelectorAll('#codeModelMenu.open, #modelMenu.open').forEach((menu) => fitModelMenu(menu));
  });
  function closePops() { document.querySelectorAll('.pop.open').forEach((p) => p.classList.remove('open')); }
  function openPop(sel) {
    const p = $(sel); if (!p) return;
    const was = p.classList.contains('open');
    closePops(); window.CC.closeMenus();
    if (!was) {
      fitModelMenu(p, true);
      p.classList.add('open');
    }
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });
  $('#envMenu').querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
    if (o.disabled) return;
    $('#envName').textContent = 'Local environment';
    closePops();
  }));
  $('#envBtn').addEventListener('click', (e) => { e.stopPropagation(); openPop('#envMenu'); });

  // Modal helpers (rename, API keys, choose).
  function modal(title, bodyHTML, buttons) {
    return new Promise((resolve) => {
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = bodyHTML;
      $('#modalActs').innerHTML = buttons.map((b, i) => `<button class="p-btn${b.primary ? ' primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('');
      $('#modal').hidden = false;
      const done = (v) => { $('#modal').hidden = true; document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); done(buttons.findIndex((b) => b.primary)); }
      };
      document.addEventListener('keydown', key, true);
      $('#modalActs').querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => done(+b.dataset.i)));
      $('#modal').onclick = (e) => { if (e.target.id === 'modal') done(null); };
      $('#modalBody').onclick = (e) => { const r = e.target.closest('[data-k]'); if (r) done({ pick: +r.dataset.k }); };
      setTimeout(() => $('#modalBody input, #modalBody select')?.focus(), 30);
    });
  }
  async function inputModal(title, value) {
    const i = await modal(title, `<input class="m-in" value="${esc(value || '')}">`, [{ label: 'Cancel' }, { label: 'Save', primary: true }]);
    return i === 1 ? $('#modalBody input').value.trim() : null;
  }
  async function chooseModal(title, options) {
    const r = await modal(title, options.map((o, k) => `<button class="proj-row" data-k="${k}">${esc(o)}</button>`).join(''), [{ label: 'Cancel' }]);
    return r?.pick;
  }
  async function keysModal() {
    const providers = state.info.keyProviders;
    const have = await call('keys:list');
    const i = await modal('API keys', `<p class="m-note">密钥保存在本机（系统加密存储可用时会加密），只传给 pi 进程。也可以直接用环境变量或 <code>~/.pi/agent/auth.json</code>。</p>
      <label class="m-row">Provider <select class="m-in" id="keyProv">${providers.map((p) => `<option value="${p}">${p}${have.includes(p) ? ' ✓' : ''}</option>`).join('')}</select></label>
      <label class="m-row">API key <input class="m-in" id="keyVal" type="password" placeholder="留空则删除已保存的密钥" autocomplete="off"></label>`,
    [{ label: 'Cancel' }, { label: 'Save', primary: true }]);
    if (i !== 1) return;
    try {
      await call('keys:set', $('#keyProv').value, $('#keyVal').value.trim());
      toast('Saved. 新会话会使用这个密钥');
      await loadModels();
    } catch (err) { fail(err); }
  }
  $('#keysBtn').onclick = () => { window.CC.closeMenus(); keysModal(); };

  /* ================= 输入框：/ 命令与 @ 文件 ================= */
  const acPop = $('#acPop');
  let acItems = [], acSel = 0;
  function acClose() { acItems = []; acPop.classList.remove('open'); }
  async function acUpdate() {
    const pos = codeInput.selectionStart, before = codeInput.value.slice(0, pos);
    const rt = curRt();
    let m;
    if ((m = before.match(/^\/(\S*)$/))) {
      const all = [...DESKTOP_CMDS, ...(rt?.commands || []).map((c) => [`/${c.name}`, c.description || c.source])];
      acItems = all.filter(([k]) => k.slice(1).startsWith(m[1])).slice(0, 12).map(([k, d]) => ({ k, d, ins: k + ' ', from: 0 }));
    } else if ((m = before.match(/(?:^|\s)@([^\s@]*)$/)) && rt) {
      if (!rt.files) rt.files = await call('sessions:files', rt.meta.id).catch(() => []);
      const q = m[1].toLowerCase();
      acItems = rt.files.filter((p) => p.toLowerCase().includes(q)).slice(0, 10)
        .map((p) => ({ k: '@' + fname(p), d: p, ins: '@' + p + ' ', from: pos - m[1].length - 1 }));
    } else acItems = [];
    if (!acItems.length) return acClose();
    acSel = Math.min(acSel, acItems.length - 1);
    acPop.innerHTML = acItems.map((it, i) => `<button class="ac-item${i === acSel ? ' sel' : ''}" data-i="${i}"><span class="ac-k">${esc(it.k)}</span><span class="ac-d">${esc(it.d)}</span></button>`).join('');
    acPop.querySelectorAll('.ac-item').forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); acPick(+b.dataset.i); }));
    acPop.classList.add('open');
  }
  function acPick(i) {
    const it = acItems[i], pos = codeInput.selectionStart, v = codeInput.value;
    codeInput.value = v.slice(0, it.from) + it.ins + v.slice(pos);
    const c = it.from + it.ins.length;
    codeInput.setSelectionRange(c, c);
    acClose(); autosize(); updateSendBtn();
  }
  const autosize = () => { codeInput.style.height = 'auto'; codeInput.style.height = Math.min(codeInput.scrollHeight, 260) + 'px'; };
  codeInput.addEventListener('input', () => { acSel = 0; autosize(); acUpdate(); updateSendBtn(); });
  codeInput.addEventListener('click', acUpdate);
  codeInput.addEventListener('blur', () => setTimeout(acClose, 120));
  codeInput.addEventListener('keydown', (e) => {
    if (acItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length; return acUpdate(); }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); return acPick(acSel); }
      if (e.key === 'Escape') { e.stopPropagation(); return acClose(); }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const cur = curRt()?.meta.mode || state.mode;
      const i = MODES.findIndex((m) => m.id === cur);
      return setPermMode(MODES[(i + 1) % MODES.length].id, true);
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.metaKey || e.ctrlKey); }
  });
  codeSend.onclick = () => send(false);
  $('.cx-box').addEventListener('click', (e) => { if (!e.target.closest('button')) codeInput.focus(); });
  $('#codeAttach').onclick = () => composer.pick();

  /* ================= 搜索面板 ================= */
  const pal = $('#palette'), palInput = $('#palInput'), palList = $('#palList');
  let palItems = [], palSel = 0;
  function openPalette() { pal.hidden = false; palInput.value = ''; palSel = 0; renderPalette(); palInput.focus(); }
  function closePalette() { pal.hidden = true; }
  function renderPalette() {
    const q = palInput.value.trim().toLowerCase();
    const acts = [
      { t: 'New session', h: 'Code', run: () => { document.body.dataset.mode = 'code'; showWelcome(); } },
      { t: 'New task', h: 'Cowork', run: () => { document.body.dataset.mode = 'chat'; showWelcome(); } },
      { t: 'Open folder…', h: '', run: () => $('#projList [data-add]')?.click() },
      { t: 'Toggle diff', h: 'Ctrl/⌘ D', run: () => $('#diffBtn').click() },
      { t: 'Toggle terminal', h: '', run: () => $('#termBtn').click() },
      { t: 'API keys…', h: '', run: keysModal },
      { t: 'Toggle theme', h: '', run: () => $('#themeToggle').click() },
    ].filter((a) => !q || a.t.toLowerCase().includes(q));
    const sess = [...state.rts.values()].filter((rt) => !rt.meta.archived && (!q || rt.meta.title.toLowerCase().includes(q)))
      .slice(0, 30).map((rt) => ({ t: rt.meta.title, h: `${isCowork(rt) ? 'Cowork' : projName(rt.meta.projectPath)} · ${ago(rt.meta.updatedAt || Date.now())}`, run: () => openSession(rt.meta.id) }));
    palItems = [...sess, ...acts];
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let i = 0;
    const row = (it) => `<button class="pal-item${i === palSel ? ' sel' : ''}" data-i="${i++}">${esc(it.t)}<span class="h">${esc(it.h)}</span></button>`;
    palList.innerHTML = (sess.length ? '<div class="pal-sec">Sessions</div>' + sess.map(row).join('') : '') +
      (acts.length ? '<div class="pal-sec">Actions</div>' + acts.map(row).join('') : '') || '<div class="pal-sec">No results</div>';
    palList.querySelectorAll('.pal-item').forEach((b) => (b.onclick = () => { closePalette(); palItems[+b.dataset.i].run(); }));
  }
  palInput.oninput = () => { palSel = 0; renderPalette(); };
  palInput.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel + (e.key === 'ArrowDown' ? 1 : palItems.length - 1)) % palItems.length; renderPalette(); }
    if (e.key === 'Enter' && palItems[palSel]) { closePalette(); palItems[palSel].run(); }
    if (e.key === 'Escape') { e.stopPropagation(); closePalette(); }
  };
  pal.onclick = (e) => { if (e.target === pal) closePalette(); };
  $('#searchBtn').onclick = openPalette;

  /* ================= 快捷键 ================= */
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return pal.hidden ? openPalette() : closePalette(); }
    if ((document.body.dataset.mode !== 'code' && document.body.dataset.view !== 'thread') || !pal.hidden || !$('#modal').hidden) return;
    const rt = curRt();
    if (e.key === 'Escape') { closePops(); if (rt?.running) { e.preventDefault(); stop(rt); } app.classList.remove('mobile-open'); return; }
    if (mod && e.key.toLowerCase() === 'o' && rt) { e.preventDefault(); cycleViewMode(); return; }
    if (mod && e.key.toLowerCase() === 'd' && rt) { e.preventDefault(); (isCowork(rt) ? $('#panelBtn') : $('#diffBtn')).click(); return; }
    if (rt?.perm?.type === 'perm' && ['1', '2', '3'].includes(e.key) && !codeInput.value.trim() && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      const v = PERM_OPTIONS[+e.key - 1];
      answerUi(rt, rt.perm, { value: v }, v);
    }
  });


  /* ================= Cowork ================= */
  // Tasks list in the Cowork sidebar.
  function renderTasks() {
    const box = $('#recents');
    const tasks = [...state.rts.values()].filter((rt) => isCowork(rt) && !rt.meta.archived)
      .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
    box.innerHTML = tasks.length ? '' : '<li class="tk-empty">No tasks yet</li>';
    for (const rt of tasks) {
      const li = document.createElement('li');
      li.className = isCur(rt) ? 'active' : '';
      const icon = rt.perm ? `<i class="tk-ic warn" title="Needs your input">${I.warn}</i>`
        : rt.running ? '<i class="tk-ic"><span class="si run"></span></i>'
        : rt.unread ? '<i class="tk-ic"><span class="si unread"></span></i>' : '<i class="tk-ic"></i>';
      li.innerHTML = `${icon}<span></span><button class="more" title="Archive"><svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg></button>`;
      li.querySelector('span').textContent = rt.meta.title;
      li.title = rt.perm ? 'Needs your input' : rt.running ? 'Working…' : `${rt.meta.title} · ${ago(rt.meta.updatedAt || Date.now(), true)}`;
      li.onclick = () => openSession(rt.meta.id);
      li.querySelector('.more').onclick = async (e) => {
        e.stopPropagation();
        const i = await modal(`Archive “${rt.meta.title}”?`, '<p class="m-note">任务会从列表中移除，文件夹里的文件不受影响。</p>', [{ label: 'Cancel' }, { label: 'Archive', primary: true }]);
        if (i !== 1) return;
        await call('sessions:archive', rt.meta.id).catch(fail);
        rt.meta.archived = true;
        if (isCur(rt)) showWelcome(); else renderTasks();
      };
      box.appendChild(li);
    }
  }

  const input = $('#input');
  const sendBtn = $('#sendBtn');
  function showCoworkWelcome() {
    $('#welcome').hidden = false;
    if ($('#composer').parentElement !== $('#welcomeSlot')) $('#welcomeSlot').appendChild($('#composer'));
    renderFolderButton();
    renderModelButtons();
    renderTasks();
    renderSessions();
    composer.activate(welcomeDraftKey(), 'cowork');
    input.focus();
  }

  // "Project or folder" tray: recent folders, pick a folder, or a temporary workspace.
  function renderFolderButton() {
    const f = state.coworkFolder;
    $('#folderName').textContent = f ? projName(f) : f === null ? 'Temporary workspace' : 'Project or folder';
    $('#folderBtn').title = f || '每个任务新建一个临时工作区';
    const rows = state.coworkFolders.map((x) => `<button class="proj-row" data-v="${esc(x.path)}" title="${esc(x.path)}">${I.folder}<span>${esc(x.name)}</span>${x.path === f ? I.check : ''}</button>`).join('');
    $('#folderMenu').innerHTML = `<div class="pop-label">Work in a folder</div>${rows}
      <button class="proj-row" data-add>${I.plus}<span>Choose folder…</span></button>
      <div class="menu-sep"></div>
      <button class="proj-row" data-none>${I.file}<span>Temporary workspace</span>${f === null ? I.check : ''}</button>`;
    $('#folderMenu').querySelectorAll('.proj-row').forEach((b) => (b.onclick = async () => {
      closePops();
      if (b.dataset.add !== undefined) {
        const folder = await call('cowork:addFolder').catch(fail);
        if (!folder) return;
        state.coworkFolders = await call('cowork:folders');
        setCoworkFolder(folder.path);
      } else if (b.dataset.none !== undefined) setCoworkFolder(null);
      else {
        call('cowork:useFolder', b.dataset.v).catch(() => {});
        setCoworkFolder(b.dataset.v);
      }
      input.focus();
    }));
  }
  function setCoworkFolder(f) {
    state.coworkFolder = f;
    if (!curRt()) composer.activate(welcomeDraftKey(), 'cowork');
    store.set('pd_cowork_folder', f);
    renderFolderButton();
  }
  $('#folderBtn').addEventListener('click', (e) => { e.stopPropagation(); openPop('#folderMenu'); });

  // Model menu inside the Cowork composer (model + thinking effort).
  function renderCoworkModel(byProvider, model, levels, effort) {
    $('#modelName').textContent = modelName(state.model);
    $('#coworkEffort').textContent = state.levels.length > 1 ? LEVEL_LABEL[state.effort] || state.effort : '';
    $('#modelMenu').innerHTML = [...byProvider].map(([p, list]) => `<div class="pop-label">${esc(p)}</div>` + list.map((m) => {
      const id = `${m.provider}/${m.id}`;
      return `<button class="model-opt${id === state.model ? ' active' : ''}" data-v="${esc(id)}"><b>${esc(m.name || m.id)}</b><small>${m.contextWindow ? `${fmtTok(m.contextWindow)} context` : ''}</small></button>`;
    }).join('')).join('') +
      (state.levels.length > 1 ? `<div class="pop-label">Thinking</div><div class="eff-row">${state.levels.map((l) => `<button class="eff-chip${l === state.effort ? ' on' : ''}" data-l="${l}">${LEVEL_LABEL[l] || l}</button>`).join('')}</div>` : '') +
      '<div class="menu-sep"></div><button class="model-opt" data-keys><b>Add API key…</b></button>';
    $('#modelMenu').querySelectorAll('[data-v]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      window.CC.closeMenus();
      await chooseModel(b.dataset.v); // welcome page: no current session, so this sets the default
    }));
    $('#modelMenu').querySelectorAll('[data-l]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      state.effort = b.dataset.l;
      store.set('pd_effort', state.effort);
      renderModelButtons();
    }));
    $('#modelMenu').querySelector('[data-keys]').onclick = () => { window.CC.closeMenus(); keysModal(); };
  }
  $('#modelBtn').onclick = (e) => {
    e.stopPropagation();
    openPop('#modelMenu');
  };

  // Welcome and thread composers submit the same session-owned draft.
  const autosizeCowork = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 240) + 'px'; };
  input.addEventListener('input', () => { autosizeCowork(); updateSendBtn(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); coworkSend(); }
  });
  sendBtn.onclick = coworkSend;
  function coworkSend() { send(false); }
  $('#attachBtn').onclick = () => composer.pick();
  document.querySelectorAll('.chip.idea').forEach((c) => (c.onclick = () => {
    input.value = c.dataset.prompt;
    composer.current();
    autosizeCowork();
    updateSendBtn();
    input.focus();
  }));

  // Right panel for Cowork tasks: progress, files Claude produced, and context.
  const coworkCard = document.createElement('section');
  coworkCard.className = 'card cw-panel';
  coworkCard.id = 'coworkCard';
  coworkCard.hidden = true;
  coworkCard.innerHTML = `<header class="card-h"><span class="ttl">Progress</span><div class="card-tools"><button class="ic-btn sm" data-x title="Close">${I.close}</button></div></header><div class="card-b" id="coworkBody"></div>`;
  $('#dockPrimary').prepend(coworkCard);
  coworkCard.querySelector('[data-x]').onclick = () => { const rt = curRt(); if (rt) { rt.panelOpen = false; renderRight(); } };
  $('#panelBtn').onclick = () => { const rt = curRt(); if (!rt) return; rt.panelOpen = !rt.panelOpen; renderRight(); };

  function renderCoworkPanel(rt) {
    if (!rt || coworkCard.hidden) return;
    const todos = rt.lastTodos || [];
    const done = todos.filter((t) => t.status === 'completed').length;
    const outputs = [...rt.outputs].sort((a, b) => b.t - a.t);
    $('#coworkBody').innerHTML = `
      <div class="cwp-sec">
        <div class="cwp-h">Progress${todos.length ? `<span>${done}/${todos.length}</span>` : ''}</div>
        ${todos.length ? `<div class="cwp-bar"><i style="width:${(done / todos.length) * 100}%"></i></div>` + todos.map((t) => `<div class="td ${t.status}"><span class="td-box"></span><span>${esc(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content)}</span></div>`).join('')
          : `<div class="cwp-empty">${rt.running ? 'Claude 正在了解任务…' : '多步骤的任务会在这里显示进度。'}</div>`}
      </div>
      <div class="cwp-sec">
        <div class="cwp-h">Files${outputs.length ? `<span>${outputs.length}</span>` : ''}</div>
        ${outputs.length ? outputs.map((o) => `<div class="cwp-file" data-p="${esc(o.path)}">${I.file}<div class="fmeta"><b>${esc(fname(o.path))}</b><small>${esc(fdir(o.path) || (rt.meta.scratch ? 'workspace' : projName(rt.meta.cwd)))} · ${o.kind === 'write' ? 'created' : 'edited'}</small></div>
            <button class="ic-btn sm" data-open title="Open">${I.expand}</button><button class="ic-btn sm" data-reveal title="Show in folder">${I.folder}</button></div>`).join('')
          : '<div class="cwp-empty">Claude 创建或修改的文件会出现在这里。</div>'}
      </div>
      <div class="cwp-sec">
        <div class="cwp-h">Context</div>
        <div class="cwp-ctx" data-folder>${I.folder}<div class="fmeta"><b>${esc(rt.meta.scratch ? 'Temporary workspace' : projName(rt.meta.cwd))}</b><small>${esc(rt.meta.cwd)}</small></div></div>
        <div class="cwp-ctx">${I.code}<div class="fmeta"><b>${esc(modelName(rt.model))}</b><small>${esc(MODES.find((m) => m.id === rt.meta.mode)?.name || 'Auto')} · ${rt.ctxPct != null ? `${Math.round(rt.ctxPct)}% context used` : 'context'}</small></div></div>
      </div>`;
    $('#coworkBody').querySelectorAll('.cwp-file').forEach((row) => {
      const rel = row.dataset.p;
      row.onclick = (e) => {
        if (e.target.closest('[data-open]')) return call('sessions:openPath', rt.meta.id, rel, false).catch(fail);
        if (e.target.closest('[data-reveal]')) return call('sessions:openPath', rt.meta.id, rel, true).catch(fail);
        openFileRef(rel);
      };
    });
    $('#coworkBody').querySelector('[data-folder]').onclick = () => call('sessions:openPath', rt.meta.id, '.', false).catch(fail);
  }

  /* ================= 启动 ================= */
  api.on('pi:event', ({ sessionId, event }) => onPiEvent(sessionId, event));
  api.on('pi:status', ({ sessionId, status }) => {
    const rt = state.rts.get(sessionId);
    if (rt && status === 'idle' && rt.running) settle(rt);
  });
  api.on('pi:exit', ({ sessionId, code, stderr, error }) => {
    const rt = state.rts.get(sessionId);
    if (!rt) return;
    if (rt.running) settle(rt, true);
    rt.processVersion++;
    for (const p of [...rt.pendingUser]) {
      p.exited = true;
      removeUser(rt, p);
      // Unacknowledged submissions still own their locked draft. Acknowledged
      // queues have cleared it, so recover the retained bytes before replay.
      if (p.acknowledged && !p.delivered) composer.recover(sessionDraftKey(rt), p.submission);
    }
    rt.loaded = false;
    if (code) push(rt, { type: 'note', level: 'error', text: `pi 进程退出（${code}）${error ? `：${error}` : ''}\n${(stderr || '').trim().split('\n').slice(-6).join('\n')}` });
    if (isCur(rt)) refreshChrome();
  });

  (async () => {
    state.info = await call('app:info');
    $('#menuInfo').textContent = `pi coding agent · v${state.info.version}`;
    state.projects = await call('projects:list');
    if (!state.projects.some((p) => p.path === state.project)) state.project = state.projects[0]?.path || null;
    for (const meta of await call('sessions:list')) runtime(meta);
    state.coworkFolders = await call('cowork:folders');
    if (state.coworkFolder === undefined) state.coworkFolder = state.coworkFolders[0]?.path ?? null;
    else if (state.coworkFolder && !state.coworkFolders.some((f) => f.path === state.coworkFolder)) state.coworkFolder = state.coworkFolders[0]?.path ?? null;
    showWelcome();
    await loadModels();
  })().catch(fail);
})();
