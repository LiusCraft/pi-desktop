// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
(() => {
  const native = window.piDesktop;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const call = (channel, ...args) => native.invoke(channel, ...args);
  const errText = (err) => String(err?.message || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '操作失败';

  const boot = native?.boot || {};
  const platform = boot.info?.platform || native?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const revealLabel = isMac ? '在 Finder 中显示' : '在资源管理器中显示';

  const state = {
    settings: boot.settings || {},
    info: boot.info || {},
    keys: {},
    projects: [],
    folders: [],
    section: 'appearance',
  };

  document.body.dataset.os = isMac ? 'mac' : 'win';
  applyTheme(state.settings);

  function applyTheme(s) {
    document.documentElement.dataset.theme = s?.resolvedTheme || 'dark';
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ================= 分段渲染 ================= */
  // Templates are built locally and every interpolated value goes through esc(),
  // so assigning an HTML string is never necessary: parse once, adopt the nodes.
  function setHTML(el, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.replaceChildren(...Array.from(doc.body.childNodes));
  }

  function keyBadge(k) {
    if (k.saved) return '<span class="badge ok">已保存</span>';
    if (k.envSet) return '<span class="badge env">环境变量已设置</span>';
    return '<span class="badge">未设置</span>';
  }

  function switchBtn(id, on) {
    return `<button class="sw" role="switch" id="${id}" aria-checked="${on ? 'true' : 'false'}"><i></i></button>`;
  }

  function themeOption(id, label, current) {
    const on = id === current;
    return `<button class="theme-opt${on ? ' on' : ''}" data-theme="${id}" aria-pressed="${on}">
      <span class="pv pv-${id}"><i class="pv-sb"></i><span class="pv-bd"><b></b><b></b><b></b></span></span>
      <span class="pv-l">${label}</span>
    </button>`;
  }

  const SECTIONS = {
    appearance: {
      html() {
        const current = state.settings.theme === 'system'
          ? 'system'
          : state.settings.theme || state.settings.resolvedTheme || 'dark';
        return `
          <h2>外观</h2>
          <p class="s-sub">Pi Desktop 在这台电脑上的显示方式。</p>
          <div class="card">
            <div class="row col">
              <div class="lbl"><b>主题</b><small>跟随系统时会随 macOS / Windows 的外观自动切换。</small></div>
              <div class="themes">
                ${themeOption('light', '浅色', current)}
                ${themeOption('dark', '深色', current)}
                ${themeOption('system', '跟随系统', current)}
              </div>
            </div>
            <div class="row">
              <div class="lbl"><b>侧边栏</b><small>启动时收起左侧导航，只留下图标列。</small></div>
              ${switchBtn('swSidebar', state.settings.sidebarCollapsed)}
            </div>
          </div>`;
      },
      wire(root) {
        $$('[data-theme]', root).forEach((b) => (b.onclick = () => patch({ theme: b.dataset.theme })));
        $('#swSidebar', root).onclick = () => patch({ sidebarCollapsed: !state.settings.sidebarCollapsed });
      },
    },

    general: {
      html() {
        const mode = state.settings.defaultMode === 'chat' ? 'chat' : 'code';
        return `
          <h2>通用</h2>
          <p class="s-sub">通知与默认视图。</p>
          <div class="card">
            <div class="row">
              <div class="lbl"><b>任务通知</b><small>任务跑完且窗口不在最前面时，发送系统通知。</small></div>
              ${switchBtn('swNotify', state.settings.notify !== false)}
            </div>
            <div class="row">
              <div class="lbl"><b>默认分区</b><small>第一次启动时打开的视图；之后会记住你最后切换到的分区。</small></div>
              <div class="seg2">
                <button data-mode="code" class="${mode === 'code' ? 'on' : ''}">Code</button>
                <button data-mode="chat" class="${mode === 'chat' ? 'on' : ''}">Cowork</button>
              </div>
            </div>
          </div>`;
      },
      wire(root) {
        $('#swNotify', root).onclick = () => patch({ notify: state.settings.notify === false });
        $$('[data-mode]', root).forEach((b) => (b.onclick = () => patch({ defaultMode: b.dataset.mode })));
      },
    },

    keys: {
      html() {
        const providers = Object.keys(state.keys);
        const rows = providers.length
          ? providers.map((p) => {
            const k = state.keys[p];
            return `<tr>
              <td><b>${esc(p)}</b></td>
              <td class="env">${esc(k.env)}</td>
              <td>${keyBadge(k)}</td>
              <td>${k.saved ? `<button class="btn sm danger" data-del="${esc(p)}">删除</button>` : ''}</td>
            </tr>`;
          }).join('')
          : '<tr><td colspan="4" class="empty">读取中…</td></tr>';
        return `
          <h2>API 密钥</h2>
          <p class="s-sub">只保存在这台电脑上，仅传给 pi 进程。</p>
          <p class="note">${state.settings.secureKeys
            ? '系统加密存储可用，密钥会加密后写入磁盘。'
            : '当前系统没有可用的加密存储，密钥以明文保存在应用数据目录。'}
            也可以改用环境变量或 <code>~/.pi/agent/auth.json</code>，pi 会优先使用这里保存的密钥。</p>
          <div class="card">
            <div class="key-form">
              <select class="in" id="keyProv">${providers.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
              <input class="in" id="keyVal" type="password" placeholder="粘贴 API key，留空保存则删除" autocomplete="off" spellcheck="false">
              <button class="btn primary" id="keySave">保存</button>
            </div>
            <table class="kv">
              <thead><tr><th>Provider</th><th>环境变量</th><th>状态</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      },
      wire(root) {
        const save = async () => {
          const provider = $('#keyProv', root).value;
          const value = $('#keyVal', root).value.trim();
          const btn = $('#keySave', root);
          btn.disabled = true;
          btn.textContent = '保存中…';
          try {
            await call('keys:set', provider, value);
            state.keys = await call('keys:status');
            render();
            toast(value ? '已保存，新会话会使用这个密钥' : '已删除');
          } catch (err) {
            toast(errText(err));
            btn.disabled = false;
            btn.textContent = '保存';
          }
        };
        $('#keySave', root).onclick = save;
        $('#keyVal', root).onkeydown = (e) => { if (e.key === 'Enter') save(); };
        $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
          try {
            await call('keys:set', b.dataset.del, '');
            state.keys = await call('keys:status');
            render();
            toast('已删除');
          } catch (err) { toast(errText(err)); }
        }));
      },
    },

    projects: {
      html() {
        const rows = (list, kind) => (list.length
          ? list.map((p) => `<div class="p-row">
              <div class="p-meta"><b>${esc(p.name)}</b><span class="p-path" title="${esc(p.path)}">${esc(p.path)}</span></div>
              <button class="btn sm" data-show="${esc(p.path)}">${revealLabel}</button>
              <button class="btn sm danger" data-remove="${esc(p.path)}" data-kind="${kind}">移除</button>
            </div>`).join('')
          : '<div class="empty">还没有添加。</div>');
        return `
          <h2>项目与文件夹</h2>
          <p class="s-sub">Code 会话的项目，以及 Cowork 可用的工作文件夹。</p>
          <h3>Code 项目<button class="btn sm" data-add="project">添加…</button></h3>
          <div class="card">${rows(state.projects, 'project')}</div>
          <h3>Cowork 文件夹<button class="btn sm" data-add="folder">添加…</button></h3>
          <div class="card">${rows(state.folders, 'folder')}</div>`;
      },
      wire(root) {
        const reload = async () => {
          state.projects = await call('projects:list').catch(() => state.projects);
          state.folders = await call('cowork:folders').catch(() => state.folders);
          render();
        };
        $$('[data-add]', root).forEach((b) => (b.onclick = async () => {
          try {
            const added = await call(b.dataset.add === 'project' ? 'projects:add' : 'cowork:addFolder');
            await reload();
            if (added) toast(`已添加 ${added.name}`);
          } catch (err) { toast(errText(err)); }
        }));
        $$('[data-show]', root).forEach((b) => (b.onclick = () => call('app:revealPath', b.dataset.show).catch((err) => toast(errText(err)))));
        $$('[data-remove]', root).forEach((b) => (b.onclick = async () => {
          try {
            if (b.dataset.kind === 'project') await call('projects:remove', b.dataset.remove);
            else await call('cowork:removeFolder', b.dataset.remove);
            await reload();
            toast('已从列表移除，磁盘上的文件不受影响');
          } catch (err) { toast(errText(err)); }
        }));
      },
    },

    about: {
      html() {
        const v = state.info.versions || {};
        const ver = [state.info.version && `v${state.info.version}`, v.electron && `Electron ${v.electron}`, v.chrome && `Chromium ${v.chrome}`, v.node && `Node ${v.node}`]
          .filter(Boolean).join(' · ');
        return `
          <h2>关于</h2>
          <p class="s-sub">基于 pi coding agent 的桌面客户端。</p>
          <div class="card">
            <div class="row">
              <div class="lbl"><b>Pi Desktop${state.info.demo ? '（演示模式）' : ''}</b><small>${esc(ver)}</small></div>
            </div>
            <div class="row">
              <div class="lbl"><b>数据目录</b><span class="p-path" title="${esc(state.info.userData || '')}">${esc(state.info.userData || '')}</span></div>
              <button class="btn sm" data-open="${esc(state.info.userData || '')}">打开</button>
              <button class="btn sm" data-copy="${esc(state.info.userData || '')}">复制路径</button>
            </div>
          </div>`;
      },
      wire(root) {
        $('[data-open]', root).onclick = () => call('app:revealPath', state.info.userData).catch((err) => toast(errText(err)));
        $('[data-copy]', root).onclick = async () => {
          try {
            await navigator.clipboard.writeText(state.info.userData || '');
            toast('已复制');
          } catch { toast('复制失败'); }
        };
      },
    },
  };

  function render() {
    $$('#sNav .s-nav-i').forEach((b) => b.classList.toggle('on', b.dataset.sec === state.section));
    const sec = SECTIONS[state.section] || SECTIONS.appearance;
    const main = $('#sMain');
    setHTML(main, sec.html());
    main.scrollTop = 0;
    sec.wire?.(main);
  }

  function go(section) {
    state.section = SECTIONS[section] ? section : 'appearance';
    try { history.replaceState(null, '', `#${state.section}`); } catch {}
    render();
  }

  function sameSettings(s) {
    return JSON.stringify(s) === JSON.stringify(state.settings);
  }

  async function patch(values) {
    try {
      const next = await call('settings:set', values);
      if (!sameSettings(next)) {
        state.settings = next;
        applyTheme(next);
        render();
      }
    } catch (err) { toast(errText(err)); }
  }

  /* ================= 启动 ================= */
  if (!native) {
    setHTML($('#sMain'), '<h2>设置</h2><p class="s-sub">设置窗口只能在 Pi Desktop 应用里打开。</p>');
    return;
  }

  $('#sNav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sec]');
    if (btn) go(btn.dataset.sec);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); call('settings:close').catch(() => {}); }
  });

  native.on('settings:changed', (s) => {
    if (sameSettings(s)) return;
    state.settings = s;
    applyTheme(s);
    if (state.section === 'appearance' || state.section === 'general') render();
  });
  native.on('settings:section', go);

  state.section = SECTIONS[location.hash.slice(1)] ? location.hash.slice(1) : 'appearance';
  render();

  (async () => {
    const [settings, info, keys, projects, folders] = await Promise.all([
      call('settings:get').catch(() => null),
      call('app:info').catch(() => null),
      call('keys:status').catch(() => null),
      call('projects:list').catch(() => null),
      call('cowork:folders').catch(() => null),
    ]);
    // The preload also ships these synchronously; re-reading keeps the window
    // correct even if that bootstrap ever fails.
    if (settings && !sameSettings(settings)) {
      state.settings = settings;
      applyTheme(settings);
    }
    if (info) state.info = { ...state.info, ...info };
    if (keys) state.keys = keys;
    if (projects) state.projects = projects;
    if (folders) state.folders = folders;
    render();
  })();
})();
