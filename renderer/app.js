// Shared renderer utilities and window chrome: theme, sidebar, user menu,
// toast, Markdown and syntax highlighting. Cowork and Code views live in code.js.
(() => {
  const $ = (s) => document.querySelector(s);
  const app = $('#app');

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  /* ---------------- 主题 / 设置 ---------------- */
  // Settings live in the main process; the preload hands them over synchronously
  // so the first paint already uses the right theme and sidebar state.
  const native = window.piDesktop;
  const bootSettings = native?.boot?.settings || null;
  const resolvedTheme = (s) => (s?.theme === 'system' ? s.resolvedTheme : s?.theme) || s?.resolvedTheme || 'dark';
  const applyTheme = (t) => { document.documentElement.dataset.theme = t; store.set('cc_theme', t); };
  applyTheme(bootSettings ? resolvedTheme(bootSettings) : store.get('cc_theme', 'dark'));
  // Same value, one retry: keeps the theme right if the sync bootstrap ever fails.
  if (!bootSettings) native?.invoke('settings:get').then((s) => s && applyTheme(resolvedTheme(s))).catch(() => {});
  // code.js opens the mode remembered in localStorage; on the very first run there
  // is nothing stored yet, so the default-mode setting decides.
  if (bootSettings?.defaultMode && store.get('cc_mode', null) === null) store.set('cc_mode', bootSettings.defaultMode);
  $('#themeToggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    native?.invoke('settings:set', { theme: next }).catch(() => {});
    closeMenus();
  };

  /* ---------------- 问候语 ---------------- */
  const h = new Date().getHours();
  $('#greetText').textContent = h < 5 || h >= 22 ? 'Still up?' : 'You’re here!';

  /* ---------------- 侧边栏 ---------------- */
  const isMobile = () => matchMedia('(max-width: 768px)').matches;
  const sidebar = $('#sidebar'), sidebarResize = $('#sidebarResize'), sidebarToggle = $('#toggleSidebar'), sidebarTip = $('#sidebarTip');
  const isMac = native ? native.platform === 'darwin' : /Mac/i.test(navigator.platform);
  const sidebarKey = isMac ? '⌘ B' : 'Ctrl B';
  const sidebarMin = 260, sidebarMax = () => Math.max(sidebarMin, Math.min(480, app.clientWidth - 480));
  const clampSidebar = (width) => Math.max(sidebarMin, Math.min(sidebarMax(), width));
  const savedWidth = store.get('pd_sidebar_width', 340);
  let sidebarWidth = Number.isFinite(savedWidth) ? Math.max(sidebarMin, Math.min(480, savedWidth)) : 340;
  let cancelSidebarDrag = null, sidebarTipTimer, sidebarHoverY = 0;
  $('#sidebarShortcut').textContent = sidebarKey;
  sidebarToggle.setAttribute('aria-keyshortcuts', isMac ? 'Meta+B' : 'Control+B');

  function hideSidebarTip() {
    clearTimeout(sidebarTipTimer);
    sidebarTip.hidden = true;
    sidebarResize.removeAttribute('aria-describedby');
  }
  function positionSidebarTip() {
    const seam = sidebarResize.getBoundingClientRect();
    sidebarTip.style.left = `${Math.max(8, Math.min(seam.x + seam.width / 2 + 12, innerWidth - sidebarTip.offsetWidth - 8))}px`;
    sidebarTip.style.top = `${Math.max(8, Math.min(sidebarHoverY - sidebarTip.offsetHeight / 2, innerHeight - sidebarTip.offsetHeight - 8))}px`;
  }
  function queueSidebarTip(y) {
    hideSidebarTip();
    sidebarHoverY = y;
    if (isMobile() || app.classList.contains('collapsed') || cancelSidebarDrag) return;
    sidebarTipTimer = setTimeout(() => {
      sidebarTip.hidden = false;
      positionSidebarTip();
      sidebarResize.setAttribute('aria-describedby', 'sidebarTip');
    }, 700);
  }
  function fitSidebar() {
    const width = clampSidebar(sidebarWidth);
    app.style.setProperty('--sidebar-width', `${width}px`);
    sidebarResize.setAttribute('aria-valuemin', sidebarMin);
    sidebarResize.setAttribute('aria-valuemax', sidebarMax());
    sidebarResize.setAttribute('aria-valuenow', width);
    sidebarResize.setAttribute('aria-valuetext', `${Math.round(width)} pixels`);
  }
  function syncSidebarToggle() {
    const collapsed = app.classList.contains('collapsed');
    sidebarToggle.setAttribute('aria-expanded', !collapsed);
    sidebarToggle.title = `${collapsed ? 'Show' : 'Hide'} sidebar  ${sidebarKey}`;
  }
  function setSidebarCollapsed(collapsed) {
    hideSidebarTip();
    cancelSidebarDrag?.();
    if (collapsed && document.activeElement === sidebarResize) sidebarToggle.focus();
    app.classList.toggle('collapsed', collapsed);
    syncSidebarToggle();
    store.set('cc_collapsed', collapsed);
    native?.invoke('settings:set', { sidebarCollapsed: collapsed }).catch(() => {});
  }
  if (bootSettings ? bootSettings.sidebarCollapsed : store.get('cc_collapsed', false)) app.classList.add('collapsed');
  fitSidebar();
  syncSidebarToggle();
  sidebarToggle.onclick = () => {
    if (isMobile()) return app.classList.remove('mobile-open');
    setSidebarCollapsed(!app.classList.contains('collapsed'));
  };
  sidebarResize.onpointerenter = (e) => { if (e.pointerType !== 'touch' && !e.buttons) queueSidebarTip(e.clientY); };
  sidebarResize.onpointermove = (e) => {
    if (cancelSidebarDrag) return;
    sidebarHoverY = e.clientY;
    if (!sidebarTip.hidden) positionSidebarTip();
  };
  sidebarResize.onpointerleave = hideSidebarTip;
  sidebarResize.onfocus = () => {
    const rect = sidebarResize.getBoundingClientRect();
    queueSidebarTip(rect.y + rect.height / 2);
  };
  sidebarResize.onblur = hideSidebarTip;
  sidebarResize.ondblclick = () => { if (!isMobile()) setSidebarCollapsed(true); };
  sidebarResize.onpointerdown = (e) => {
    if (e.button !== 0 || e.isPrimary === false || isMobile() || app.classList.contains('collapsed')) return;
    e.preventDefault();
    hideSidebarTip();
    cancelSidebarDrag?.();
    const start = sidebar.getBoundingClientRect().width;
    let shield = null, moved = false;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const delta = ev.clientX - e.clientX;
      // Leave clicks alone so a double-click never saves a transient width.
      if (!moved && Math.abs(delta) < 3) return;
      if (!moved) {
        moved = true;
        shield = document.createElement('div');
        shield.className = 'resize-shield';
        document.body.appendChild(shield);
        document.body.classList.add('workspace-resizing', 'sidebar-resizing');
        sidebarResize.classList.add('dragging');
      }
      sidebarWidth = clampSidebar(start + delta);
      fitSidebar();
    };
    const finish = (ev) => {
      if (ev?.pointerId !== undefined && ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      sidebarResize.removeEventListener('lostpointercapture', finish);
      cancelSidebarDrag = null;
      if (sidebarResize.hasPointerCapture(e.pointerId)) sidebarResize.releasePointerCapture(e.pointerId);
      shield?.remove();
      sidebarResize.classList.remove('dragging');
      document.body.classList.remove('workspace-resizing', 'sidebar-resizing');
      if (moved) store.set('pd_sidebar_width', sidebarWidth);
    };
    cancelSidebarDrag = finish;
    try { sidebarResize.setPointerCapture(e.pointerId); } catch {}
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    sidebarResize.addEventListener('lostpointercapture', finish);
  };
  sidebarResize.onkeydown = (e) => {
    if (isMobile() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    hideSidebarTip();
    const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 40 : 10);
    sidebarWidth = e.key === 'Home' ? sidebarMin : e.key === 'End' ? sidebarMax() : clampSidebar(clampSidebar(sidebarWidth) + delta);
    fitSidebar();
    store.set('pd_sidebar_width', sidebarWidth);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSidebarTip();
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod || e.altKey || e.shiftKey || !['b', '.'].includes(e.key.toLowerCase()) || e.isComposing) return;
    e.preventDefault();
    if (!e.repeat) {
      if (isMobile()) app.classList.toggle('mobile-open');
      else setSidebarCollapsed(!app.classList.contains('collapsed'));
    }
  }, true);
  window.addEventListener('blur', hideSidebarTip);
  window.addEventListener('resize', () => {
    hideSidebarTip();
    cancelSidebarDrag?.();
    fitSidebar();
    if (isMobile() && document.activeElement === sidebarResize) sidebarResize.blur();
  });
  document.querySelectorAll('.open-sb').forEach((b) => (b.onclick = () => app.classList.add('mobile-open')));
  $('#scrim').onclick = () => app.classList.remove('mobile-open');

  /* ---------------- 用户菜单 ---------------- */
  const userMenu = $('#userMenu');
  function closeMenus() {
    userMenu.classList.remove('open');
    document.querySelectorAll('.model-menu.open').forEach((m) => m.classList.remove('open'));
  }
  $('#userChip').onclick = (e) => { e.stopPropagation(); const was = userMenu.classList.contains('open'); closeMenus(); if (!was) userMenu.classList.add('open'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu, .model-menu')) closeMenus(); });

  /* ---------------- Markdown ---------------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (s) => {
    // Protect code and URLs before formatting emphasis, including underscores in URLs.
    const slots = [];
    const hold = (html) => `\uE000${slots.push(html) - 1}\uE001`;
    const restore = (text) => text.replace(/\uE000(\d+)\uE001/g, (_, i) => slots[i] ?? '');
    const emphasis = (text) => text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    const link = (url, label = url) => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    let t = esc(s).replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`));
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g,
      (_, label, url) => link(url, restore(emphasis(label))));
    t = t.replace(/&lt;(https?:\/\/(?:(?!&(?:lt|gt|quot);)[^\s<>])+)&gt;/g, (_, url) => link(url));
    t = t.replace(/https?:\/\/(?:(?!&(?:lt|gt|quot);)[^\s<>\uE000\uE001])+/g, (match) => {
      let url = match.replace(/[.,!?;:，。！？；：、*]+$/u, '');
      while (/[)\]}]$/.test(url)) {
        const end = url.at(-1), start = { ')': '(', ']': '[', '}': '{' }[end];
        if (url.split(end).length <= url.split(start).length) break;
        url = url.slice(0, -1);
      }
      return link(url) + match.slice(url.length);
    });
    return restore(emphasis(t));
  };

  // Use the native browser bridge in every content view, including streamed messages.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    const url = link?.getAttribute('href');
    if (!/^https?:\/\//i.test(url || '') || !window.piDesktop) return;
    e.preventDefault();
    window.piDesktop.invoke('app:openExternal', url).catch(() => toast('无法打开链接'));
  });

  function highlight(code, lang) {
    let s = esc(code);
    const kw = /\b(import|from|def|return|for|in|if|else|elif|const|let|var|function|class|async|await|with|as|print|SELECT|FROM|WHERE|JOIN|ON|GROUP BY|ORDER BY|LIMIT|new|export|default|true|false|null|undefined|this|try|catch|throw|of|typeof)\b/g;
    // 先抽出字符串和注释，避免被关键字规则二次替换
    const slots = [];
    const hold = (cls) => (m) => String.fromCharCode(0xE000 + slots.push(`<span class="${cls}">${m}</span>`) - 1);
    const cre = /^(py|python|sh|bash|shell|yaml|toml)$/.test(lang) ? /(#[^\n]*)/g : lang === 'sql' ? /(--[^\n]*)/g : /(\/\/[^\n]*)/g;
    s = s.replace(cre, hold('tok-c'))
         .replace(/(&quot;.*?&quot;|'[^'\n]*')/g, hold('tok-s'))
         .replace(kw, '<span class="tok-k">$1</span>')
         .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-n">$1</span>');
    return s.replace(/[-]/g, (ch) => slots[ch.charCodeAt(0) - 0xE000]);
  }

  const COPY_ICON = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>';
  const LIST_RE = /^(\s*[-*+]|\s*\d+\.)\s/;
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  function renderMarkdown(src) {
    const out = [];
    const lines = String(src).split('\n');
    let i = 0, para = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      const fence = l.match(/^\s*```(\w*)/);
      if (fence) {
        flush();
        const lang = fence[1] || 'text';
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<div class="code-block"><div class="code-head"><span>${esc(lang)}</span><button class="copy-code">${COPY_ICON}复制</button></div><pre><code>${highlight(buf.join('\n'), lang)}</code></pre></div>`);
        continue;
      }
      const hd = l.match(/^(#{1,6})\s+(.*)$/);
      if (hd) { flush(); out.push(`<h3 class="h${hd[1].length}">${inline(hd[2])}</h3>`); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        flush();
        const head = cells(l);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>/.test(l)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
        continue;
      }
      if (LIST_RE.test(l)) {
        flush();
        const ordered = /^\s*\d+\./.test(l);
        const items = [];
        while (i < lines.length && (LIST_RE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          if (LIST_RE.test(lines[i])) items.push(lines[i].replace(LIST_RE, ''));
          else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((t) => `<li>${inline(t.replace(/^\[([ xX])\]\s/, (_, x) => (x.trim() ? '☑ ' : '☐ ')))}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l); i++;
    }
    flush();
    return out.join('');
  }

  function wireCode(root) {
    root.querySelectorAll('.copy-code').forEach((b) => {
      b.onclick = () => {
        navigator.clipboard?.writeText(b.closest('.code-block').querySelector('code').innerText).catch(() => {});
        toast('已复制');
      };
    });
  }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenus(); app.classList.remove('mobile-open'); }
  });

  // The settings window owns every persisted preference: follow it live.
  native?.on('settings:changed', (s) => {
    if (s?.theme || s?.resolvedTheme) applyTheme(resolvedTheme(s));
  });

  window.CC = { highlight, renderMarkdown, esc, toast, closeMenus, wireCode, store, settings: bootSettings || {} };
})();
