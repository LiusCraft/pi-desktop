(() => {
  const $ = (s) => document.querySelector(s);
  const { toast } = window.CC;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  /* ---------- 窗口样式：默认跟随系统，可手动切换 ---------- */
  function setOS(os) {
    document.body.dataset.os = os;
    store.set('cc_os', os);
    $('#appMenu [data-m=os]').textContent = `Window style: ${os === 'win' ? 'macOS' : 'Windows'}`;
  }
  const native = window.piDesktop;
  if (native) {
    // Real desktop window: the OS draws the window controls; follow the platform.
    document.body.dataset.native = '1';
    document.body.dataset.os = native.platform === 'darwin' ? 'mac' : 'win';
    $('#osToggle').hidden = true;
    const syncTheme = () => native.invoke('app:theme', document.documentElement.dataset.theme).catch(() => {});
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    syncTheme();
  } else setOS(store.get('cc_os', /Windows/i.test(navigator.userAgent) ? 'win' : 'mac'));
  const toggleOS = () => setOS(document.body.dataset.os === 'win' ? 'mac' : 'win');
  $('#osToggle').onclick = () => { toggleOS(); window.CC.closeMenus(); };

  /* ---------- Windows 应用菜单 ---------- */
  const appMenu = $('#appMenu');
  $('#appMenuBtn').onclick = (e) => { e.stopPropagation(); appMenu.classList.toggle('open'); };
  appMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    appMenu.classList.remove('open');
    ({
      new: () => (document.body.dataset.mode === 'code' ? $('#newSession') : $('#newChat')).click(),
      search: () => $('#sbSearch').click(),
      theme: () => $('#themeToggle').click(),
      os: toggleOS,
      settings: () => openSettings(),
      help: () => toast('Help · claude.ai/help'),
    })[b.dataset.m]();
  });
  $('#navBack').onclick = () => history.length > 1 ? history.back() : toast('Back');
  $('#navFwd').onclick = () => toast('Forward');

  /* ---------- 设置窗口 ---------- */
  // A real window with its own lifecycle; reopening focuses the existing one.
  const openSettings = (section) => {
    if (!native) return toast('设置只在桌面应用里可用');
    native.invoke('settings:open', section).catch(() => toast('无法打开设置'));
  };
  $('#settingsBtn').onclick = () => { window.CC.closeMenus(); openSettings(); };
  // The user menu is window chrome and this file loads last, so the runner icon
  // opens the full key manager. Model menus keep code.js's quick "add a key" modal.
  $('#keysBtn').onclick = () => { window.CC.closeMenus(); openSettings('keys'); };
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  });

  /* ---------- 只做提示的按钮 ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-toast]');
    if (el && !el.closest('#moreList')) toast(el.dataset.toast);
  });
  $('#taskSearch').onclick = () => $('#sbSearch').click();

})();
