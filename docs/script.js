(() => {
  const body = document.body;
  const header = document.querySelector('[data-header]');
  const nav = document.querySelector('[data-nav]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const themeButtons = document.querySelectorAll('[data-theme-toggle]');
  const languageButton = document.querySelector('[data-lang-toggle]');

  const localeText = {
    zh: {
      navCapabilities: '能力', navModes: '工作场景', navSession: '新建会话', navDownload: '下载',
      heroTitle: 'pi 的桌面<br /><em>工作台。</em>', heroLead: 'Pi Desktop 把 pi coding agent 放进可管理的桌面工作流：项目上下文、权限确认、代码交付和远程会话都在同一个应用里。', start: '开始使用 <span>→</span>', source: '查看源码 <span>↗</span>',
      whyLabel: '01 / WHY PI DESKTOP', whyTitle: '从 agent<br /><em>到工作流。</em>', whyBody: 'pi 负责理解任务、调用模型和执行工具。Pi Desktop 负责把这些动作组织起来：知道在哪个项目里做、哪些操作需要批准、结果如何回到你手上。', whyMuted: '这就是桌面端增加的部分。', whyLink: '查看能力清单 <span>→</span>',
      addedLabel: '02 / WHAT WE ADDED TO PI', addedTitle: 'Pi Desktop<br /><em>补上了什么？</em>', addedBody: '四个能力层，分别解决执行边界、代码交付、长期任务和外部连接。',
      control: '可控地执行', controlBody: '给 pi 加上权限模式和审批边界。它可以行动，也知道什么时候必须停下来问你。', deliver: '可审阅地交付', deliverBody: '给 pi 一个安全的 Code 工作区：独立 worktree、Diff、终端、PR 和 CI 状态都在同一处。', continue: '持续地协作', continueBody: '让 pi 不只完成一轮对话：后台任务、子 agent、定时任务和会话状态都能继续推进。', connect: '连接更多能力', connectBody: '把 pi 的技能、MCP、插件和远程会话接进来，让它能在更多环境里工作。',
      modeLabel: '03 / WORK MODES', modeTitle: '同一个 agent，<br /><em>两种工作场景。</em>', modeBody: 'Code 面向软件项目，Work 面向文件和知识任务。两者共享模型、会话和 pi 的配置；等待你处理的事项都回到同一个入口。', codeMode: 'Code：从项目到 PR', codeModeBody: '每个会话使用独立 worktree，右侧查看 Diff、终端和预览，底部跟踪 PR 与 CI。', workMode: 'Work：从任务到文件', workModeBody: '在指定文件夹或临时工作区里整理资料、写文档、生成简报，移动和删除操作会先请求确认。', inboxMode: '新建会话页', inboxModeBody: 'Code 会列出待回复会话和未合并 PR；Work 会保留任务进度、生成文件和下一步。', reviewMode: '每一步都能确认', reviewModeBody: '权限请求、计划审批、Diff 和文件操作都以卡片呈现，结果交给你决定。',
      appLabel: '04 / SESSION INBOX', appTitle: '打开应用，<br /><em>先处理等待你的事。</em>', appBody: 'Code 的新建会话页聚合待回复会话和未合并 PR。Work 则从任务、文件夹和最近生成的内容继续。', detailKicker: 'CODE / 新建会话', detailTitle: '先看全局，<br />再开始写代码。', detailBody: 'Code 新建会话页会把等待你回复的会话、未合并的 Pull request 和状态一次列出来。你可以从一条消息直接回到上下文。', detailPoint1: '<i>✓</i> 待处理新消息', detailPoint2: '<i>⌘</i> Pull request 状态', detailPoint3: '<i>↗</i> 一键回到会话',
      sponsorLabel: '赞助商', sponsorTitle: 'SurgeCode', sponsorBody: '为 OpenAI、Claude 等模型提供兼容 API 接入。', permissionMode: '权限模式', moveFiles: '移动文件', awaiting: '等待确认', readFiles: '读取项目文件', allowed: '已允许', sessionFix: '会话 / 修复认证', readyZh: '就绪', changed: '3 个文件已修改', tests: '测试通过', running: '运行中', tomorrow: '明天 09:00', waiting: '等待中', connected: '已连接', available: '可用',
      downloadLabel: '05 / DOWNLOAD', downloadTitle: '获取 Pi Desktop，<br /><em>从一个会话开始。</em>', downloadBody: '安装包来自 GitHub 最新 Release；如果你使用 pi CLI，也可以直接安装 pi-remote。', latest: 'Latest release', sourceLog: '阅读源码与更新日志 <span>↗</span>', allReleases: '全部版本 ↗', download: '下载', copyInstall: '复制安装命令',
      footer: 'pi coding agent 的桌面客户端。', pageTitle: 'Pi Desktop — pi coding agent 的桌面工作台', pageDescription: '在桌面端管理 pi 的项目上下文、权限、代码交付、Work 任务和远程会话。', miniNew: '新建会话', miniProjects: '项目', miniActivity: '活动', miniSettings: '设置', miniCodeKicker: '早上好', miniCodeTitle: '今天想一起<br />完成什么？', miniCodeBody: '从一个问题开始。Pi 会先理解，再行动。', miniNeeds: '待处理', miniNeedsReply: '需要你的确认', miniNeedsReplyBody: '整理收件箱中的旧发票', miniNewReply: '新的会话回复', miniNewReplyBody: '修复认证流程 · 已完成', miniPrs: 'Pull requests', miniPrReady: 'Improve session restore', miniPrDraft: 'Update onboarding copy', miniWorkKicker: '工作区', miniWorkTitle: '今天，一起<br />把事情理顺。', miniWorkBody: '从一个任务开始，Pi 会帮你拆解并推进。', miniProgress: '今日进度', miniWorkTask1: '整理本周收件箱', miniWorkTask2: '生成项目简报', miniWorkTask3: '确认移动文件', miniApproval: '需要确认', miniInputCode: '输入消息…', miniInputWork: '告诉 Pi 接下来做什么…', detailNeeds: '需要你的回复', detailConfirm: '需要你的确认', detailConfirmBody: '移动旧文件前先问你', detailFixed: '认证流程已修复', detailFixedBody: '打开会话查看变更', detailPrs: 'Pull requests', ready: 'Ready', draft: 'Draft',
    },
    en: {
      navCapabilities: 'Capabilities', navModes: 'Work / Code', navSession: 'New session', navDownload: 'Download',
      heroTitle: "pi's desktop<br /><em>workspace.</em>", heroLead: 'Pi Desktop puts pi coding agent into a manageable desktop workflow: project context, approvals, code delivery, and remote sessions in one app.', start: 'Get Pi Desktop <span>→</span>', source: 'View source <span>↗</span>',
      whyLabel: '01 / WHY PI DESKTOP', whyTitle: 'From an agent<br /><em>to a workflow.</em>', whyBody: 'pi understands tasks, calls models, and runs tools. Pi Desktop organizes that work around a project, approval boundaries, and results you can review and pick up.', whyMuted: 'That is the desktop layer.', whyLink: 'See the capabilities <span>→</span>',
      addedLabel: '02 / WHAT WE ADDED TO PI', addedTitle: 'What does Pi Desktop<br /><em>add to pi?</em>', addedBody: 'Four capability layers for execution boundaries, code delivery, long-running work, and external connections.',
      control: 'Controlled execution', controlBody: 'Permission modes and approval boundaries let pi act while stopping when your decision is required.', deliver: 'Reviewable delivery', deliverBody: 'A safe Code workspace with isolated worktrees, Diff, terminal, PR, and CI status in one place.', continue: 'Work that continues', continueBody: 'Background tasks, subagents, schedules, and session state let pi continue beyond one turn.', connect: 'More ways to connect', connectBody: 'Bring in pi skills, MCP servers, plugins, and remote sessions so the agent can work across environments.',
      modeLabel: '03 / WORK MODES', modeTitle: 'One agent,<br /><em>two work modes.</em>', modeBody: 'Code is for software projects. Work is for files and knowledge tasks. Both share models, sessions, and pi configuration; anything waiting for you comes back to one inbox.', codeMode: 'Code: project to PR', codeModeBody: 'Each session gets an isolated worktree. Review Diff, terminal, and preview on the right; track PR and CI below.', workMode: 'Work: task to file', workModeBody: 'Work in a chosen folder or a temporary workspace. Organize files, write documents, and generate briefs with confirmation for moves and deletes.', inboxMode: 'New session inbox', inboxModeBody: 'Code surfaces sessions that need a reply and open PRs. Work keeps task progress, generated files, and the next step visible.', reviewMode: 'Review every step', reviewModeBody: 'Permission requests, plan approvals, Diff, and file actions appear as cards before you decide.',
      appLabel: '04 / SESSION INBOX', appTitle: 'Open the app,<br /><em>see what needs you.</em>', appBody: 'Code brings replies and open PRs together. Work resumes from tasks, folders, and recently generated files.', detailKicker: 'CODE / NEW SESSION', detailTitle: 'See the queue first,<br />then start coding.', detailBody: 'The Code new-session page lists conversations waiting for you, open Pull requests, and their status so you can jump back into context.', detailPoint1: '<i>✓</i> Replies waiting', detailPoint2: '<i>⌘</i> Pull request status', detailPoint3: '<i>↗</i> Jump back into context',
      sponsorLabel: 'Sponsored by', sponsorTitle: 'SurgeCode', sponsorBody: 'OpenAI and Claude compatible API access for your models.', permissionMode: 'Permission mode', moveFiles: 'Move files', awaiting: 'Awaiting approval', readFiles: 'Read project files', allowed: 'Allowed', sessionFix: 'session / fix-auth', readyZh: 'ready', changed: '3 files changed', tests: 'tests passed', running: 'running', tomorrow: 'tomorrow 09:00', waiting: 'waiting', connected: 'connected', available: 'available',
      downloadLabel: '05 / DOWNLOAD', downloadTitle: 'Get Pi Desktop,<br /><em>start with a session.</em>', downloadBody: 'Installers come from the latest GitHub Release. If you use pi CLI, install pi-remote directly.', latest: 'Latest release', sourceLog: 'Read source and release notes <span>↗</span>', allReleases: 'All releases ↗', download: 'Download', copyInstall: 'Copy install command',
      footer: 'Desktop client for pi coding agent.', pageTitle: 'Pi Desktop — the desktop workspace for pi coding agent', pageDescription: 'Manage pi project context, permissions, code delivery, Work tasks, and remote sessions from the desktop.', miniNew: 'New session', miniProjects: 'Projects', miniActivity: 'Activity', miniSettings: 'Settings', miniCodeKicker: 'GOOD MORNING', miniCodeTitle: 'What should we<br />build today?', miniCodeBody: 'Start with a question. Pi will understand, then act.', miniNeeds: 'Needs attention', miniNeedsReply: 'Approval needed', miniNeedsReplyBody: 'Sort old invoices in the inbox', miniNewReply: 'New session reply', miniNewReplyBody: 'Auth flow fixed · ready', miniPrs: 'Pull requests', miniPrReady: 'Improve session restore', miniPrDraft: 'Update onboarding copy', miniWorkKicker: 'WORKSPACE', miniWorkTitle: 'Let’s get<br />things in order.', miniWorkBody: 'Start with a task. Pi will break it down and move it forward.', miniProgress: 'Today\'s progress', miniWorkTask1: 'Sort this week\'s inbox', miniWorkTask2: 'Generate project brief', miniWorkTask3: 'Confirm file move', miniApproval: 'Needs approval', miniInputCode: 'Write a message…', miniInputWork: 'Tell Pi what to do next…', detailNeeds: 'Replies waiting', detailConfirm: 'Approval needed', detailConfirmBody: 'Review the file move', detailFixed: 'Auth flow fixed', detailFixedBody: 'Open the session to review', detailPrs: 'Pull requests', ready: 'Ready', draft: 'Draft',
    },
  };

  const localeNodes = [
    ['.main-nav a[href="#modules"]', 'navCapabilities'], ['.main-nav a[href="#features"]', 'navModes'], ['.main-nav a[href="#product"]', 'navSession'], ['.main-nav a[href="#get-started"]', 'navDownload'],
    ['#hero-title', 'heroTitle'], ['.hero-lede', 'heroLead'], ['.hero-actions .button-primary', 'start'], ['.hero-actions .button-quiet', 'source'],
    ['#why .section-label', 'whyLabel'], ['#why h2', 'whyTitle'], ['#why .intro-body p:first-child', 'whyBody'], ['#why .intro-body .muted', 'whyMuted'], ['#why .text-link', 'whyLink'],
    ['#modules .section-label', 'addedLabel'], ['#modules h2', 'addedTitle'], ['#modules .modules-heading p', 'addedBody'],
    ['.module-code h3', 'control'], ['.module-code > p', 'controlBody'], ['.module-work h3', 'deliver'], ['.module-work > p', 'deliverBody'], ['.module-customize h3', 'continue'], ['.module-customize > p', 'continueBody'], ['.module-remote h3', 'connect'], ['.module-remote > p', 'connectBody'],
    ['#features .section-label', 'modeLabel'], ['#features h2', 'modeTitle'], ['#features .feature-heading p', 'modeBody'], ['.feature-card:nth-child(1) h3', 'codeMode'], ['.feature-card:nth-child(1) p', 'codeModeBody'], ['.feature-card:nth-child(2) h3', 'workMode'], ['.feature-card:nth-child(2) p', 'workModeBody'], ['.feature-card:nth-child(3) h3', 'inboxMode'], ['.feature-card:nth-child(3) p', 'inboxModeBody'], ['.feature-card:nth-child(4) h3', 'reviewMode'], ['.feature-card:nth-child(4) p', 'reviewModeBody'],
    ['#product .section-label', 'appLabel'], ['#product h2', 'appTitle'], ['#product .product-heading p', 'appBody'], ['#product .detail-kicker', 'detailKicker'], ['#product .detail-copy h3', 'detailTitle'], ['#product .detail-copy p', 'detailBody'], ['#product .detail-points span:nth-child(1)', 'detailPoint1'], ['#product .detail-points span:nth-child(2)', 'detailPoint2'], ['#product .detail-points span:nth-child(3)', 'detailPoint3'],
    ['.sponsor-copy small', 'sponsorLabel'], ['.sponsor-copy strong', 'sponsorTitle'], ['.sponsor-copy span', 'sponsorBody'],
    ['#get-started .section-label', 'downloadLabel'], ['#get-started .cta-content h2', 'downloadTitle'], ['#get-started .cta-content p', 'downloadBody'], ['#get-started .latest-release span:nth-child(2)', 'latest'], ['#get-started .light-link', 'sourceLog'], ['.download-panel-head a', 'allReleases'], ['.site-footer .footer-note', 'footer'],
  ];

  const platform = (() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'windows';
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('linux') && /x86_64|x64|amd64/.test(ua) && !ua.includes('android')) return 'linux';
    return 'other';
  })();

  const applyLocale = (locale) => {
    const copy = localeText[locale];
    const preferred = document.querySelector(`[data-platform="${platform}"]`);
    preferred?.classList.add('is-recommended');
    const badge = preferred?.querySelector('[data-recommend-label]');
    if (badge) badge.textContent = locale === 'zh' ? '推荐' : 'Recommended';
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.body.dataset.locale = locale;
    document.title = copy.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.pageDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', copy.pageTitle);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', copy.pageDescription);
    localeNodes.forEach(([selector, key]) => {
      const node = document.querySelector(selector);
      if (node && copy[key]) node.innerHTML = copy[key];
    });
    const setMany = (selector, keys) => document.querySelectorAll(selector).forEach((node, index) => {
      const key = keys[index];
      if (key && copy[key]) node.innerHTML = copy[key];
    });
    setMany('.mini-sidebar .mini-nav span', ['miniNew', 'miniProjects', 'miniActivity', 'miniSettings']);
    setMany('.demo-code-panel .demo-section-title > span', ['miniNeeds', 'miniPrs']);
    setMany('.demo-code-panel .demo-row span:nth-child(2) strong', ['miniNeedsReply', 'miniNewReply', 'miniPrReady', 'miniPrDraft']);
    setMany('.demo-code-panel .demo-row span:nth-child(2) small', ['miniNeedsReplyBody', 'miniNewReplyBody', '#142 · Ready to merge', '#139 · Draft']);
    setMany('.demo-work-panel .demo-section-title > span', ['miniProgress']);
    setMany('.demo-work-panel .work-preview-row > span', ['miniWorkTask1', 'miniWorkTask2', 'miniWorkTask3']);
    setMany('.demo-work-panel .work-preview-row em', ['miniApproval']);
    setMany('.module-code .module-ui-title > span', ['permissionMode']);
    setMany('.module-code .module-ui-row > span', ['moveFiles', 'readFiles']);
    setMany('.module-code .module-ui-row small', ['awaiting', 'allowed']);
    setMany('.module-work .module-ui-title > span', ['sessionFix']);
    setMany('.module-work .module-ui-title b', ['readyZh']);
    setMany('.module-work .module-ui-row > span', ['changed', 'tests']);
    setMany('.module-customize .module-ui-row small', ['running', 'tomorrow', 'waiting']);
    setMany('.module-remote .remote-status small', ['connected', 'available']);
    setMany('.detail-list-title', ['detailNeeds', 'detailPrs']);
    setMany('.detail-list-row span:nth-child(2) strong', ['detailConfirm', 'detailFixed', 'Improve session restore', 'Update onboarding copy']);
    setMany('.detail-list-row span:nth-child(2) small', ['detailConfirmBody', 'detailFixedBody', '#142 · Ready to merge', '#139 · Draft']);
    const demoTitle = document.querySelector('[data-demo-title]');
    if (demoTitle) demoTitle.textContent = document.querySelector('[data-demo]')?.getAttribute('data-demo') === 'work' ? 'Work' : 'Code';
    const codeKicker = document.querySelector('.demo-code-panel .mini-kicker');
    const codeTitle = document.querySelector('.demo-code-panel .demo-welcome strong');
    const codeBody = document.querySelector('.demo-code-panel .demo-welcome p');
    const workKicker = document.querySelector('.demo-work-panel .mini-kicker');
    const workTitle = document.querySelector('.demo-work-panel .demo-work-welcome strong');
    const workBody = document.querySelector('.demo-work-panel .demo-work-welcome p');
    if (codeKicker) codeKicker.textContent = copy.miniCodeKicker;
    if (codeTitle) codeTitle.innerHTML = copy.miniCodeTitle;
    if (codeBody) codeBody.textContent = copy.miniCodeBody;
    if (workKicker) workKicker.textContent = copy.miniWorkKicker;
    if (workTitle) workTitle.innerHTML = copy.miniWorkTitle;
    if (workBody) workBody.textContent = copy.miniWorkBody;
    const inputs = document.querySelectorAll('.product-demo .mini-input span:first-child');
    if (inputs[0]) inputs[0].textContent = copy.miniInputCode;
    if (inputs[1]) inputs[1].textContent = copy.miniInputWork;
    const detailMeta = document.querySelector('.detail-window-meta');
    if (detailMeta) detailMeta.textContent = locale === 'zh' ? '2 条待回复 · 3 个 PR' : '2 replies · 3 PRs';
    const badges = document.querySelectorAll('.detail-mini-window .demo-badge');
    if (badges[0]) badges[0].textContent = copy.ready;
    if (badges[1]) badges[1].textContent = copy.draft;
    document.querySelectorAll('[data-lang-toggle]').forEach((button) => {
      button.textContent = locale === 'zh' ? 'EN' : '中';
      button.setAttribute('aria-label', locale === 'zh' ? 'Switch language' : '切换语言');
    });
    document.querySelectorAll('.download-arrow').forEach((node) => { node.textContent = locale === 'zh' ? '下载 ↓' : 'Download ↓'; });
    const copyButton = document.querySelector('[data-copy-label]');
    if (copyButton) copyButton.textContent = copy.copyInstall;
    const macDetail = document.querySelector('[data-platform="macos"] [data-platform-detail]');
    if (macDetail) macDetail.textContent = `${macArchLabel(locale)} · .dmg`;
    const windowsDetail = document.querySelector('[data-platform="windows"] [data-platform-detail]');
    if (windowsDetail) windowsDetail.textContent = locale === 'zh' ? 'x64 · .exe 安装包' : 'x64 · .exe installer';
  };

  const macArchLabel = (locale) => {
    const architecture = String(navigator.userAgentData?.architecture ?? '').toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    const arm = architecture.includes('arm') || ua.includes('arm64') || ua.includes('aarch64');
    return locale === 'zh' ? (arm ? 'Apple Silicon' : 'Intel') : (arm ? 'Apple Silicon' : 'Intel');
  };
  const initialLocale = localStorage.getItem('pi-desktop-locale') === 'en' || (!localStorage.getItem('pi-desktop-locale') && !/^zh/i.test(navigator.language)) ? 'en' : 'zh';
  applyLocale(initialLocale);
  languageButton?.addEventListener('click', () => {
    const next = document.body.dataset.locale === 'zh' ? 'en' : 'zh';
    localStorage.setItem('pi-desktop-locale', next);
    applyLocale(next);
  });

  const storedTheme = localStorage.getItem('pi-desktop-theme');
  if (storedTheme === 'dark' || (!storedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) body.classList.add('dark');

  themeButtons.forEach((button) => button.addEventListener('click', () => {
    body.classList.toggle('dark');
    localStorage.setItem('pi-desktop-theme', body.classList.contains('dark') ? 'dark' : 'light');
  }));

  menuToggle?.addEventListener('click', () => {
    const open = nav?.classList.toggle('is-open') ?? false;
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 18);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

  document.querySelectorAll('[data-demo]').forEach((demo) => {
    const modeButtons = demo.querySelectorAll('[data-demo-mode]');
    const title = demo.querySelector('[data-demo-title]');
    modeButtons.forEach((button) => button.addEventListener('click', () => {
      const mode = button.getAttribute('data-demo-mode');
      if (mode !== 'work' && mode !== 'code') return;
      demo.setAttribute('data-demo', mode);
      modeButtons.forEach((item) => item.classList.toggle('active', item === button));
      if (title) title.textContent = mode === 'work' ? 'Work' : 'Code';
    }));
  });

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    const command = button.getAttribute('data-copy');
    const label = button.querySelector('[data-copy-label]');
    const feedback = button.parentElement?.querySelector('[data-copy-feedback]');
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      if (label) label.textContent = '已复制';
      if (feedback) feedback.textContent = '命令已复制到剪贴板';
    } catch {
      if (feedback) feedback.textContent = command;
    }
    window.setTimeout(() => {
      if (label) label.textContent = '复制';
      if (feedback) feedback.textContent = '';
    }, 2200);
  }));

  const releaseApi = 'https://api.github.com/repos/LiusCraft/pi-desktop/releases/latest';
  const pluginApi = 'https://registry.npmjs.org/@liuscraft%2Fpi-remote/latest';
  const macArch = (() => {
    const architecture = String(navigator.userAgentData?.architecture ?? '').toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    return architecture.includes('arm') || ua.includes('arm64') || ua.includes('aarch64') ? 'arm64' : 'x64';
  })();

  const hydrateDownloads = async () => {
    const version = document.querySelector('[data-release-version]');
    const pluginVersion = document.querySelector('[data-plugin-version]');
    const options = document.querySelectorAll('[data-platform]');
    const macDetail = document.querySelector('[data-platform="macos"] [data-platform-detail]');
    if (macDetail) macDetail.textContent = `${macArch === 'arm64' ? 'Apple Silicon' : 'Intel'} · .dmg`;

    const [releaseResult, pluginResult] = await Promise.allSettled([fetch(releaseApi), fetch(pluginApi)]);
    if (releaseResult.status === 'fulfilled' && releaseResult.value.ok) {
      const release = await releaseResult.value.json();
      const tag = String(release.tag_name ?? '').replace(/^v/, '');
      if (version && tag) version.textContent = `v${tag}`;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const assetUrl = (pattern) => assets.find((asset) => pattern.test(String(asset.name)))?.browser_download_url;
      const macUrl = assetUrl(new RegExp(`-(${macArch})\\.dmg$`, 'i')) ?? assetUrl(/\.dmg$/i);
      const windowsUrl = assetUrl(/-win-x64-setup\.exe$/i) ?? assetUrl(/setup\.exe$/i);
      const urls = { macos: macUrl, windows: windowsUrl, linux: assetUrl(/-linux-x86_64\.AppImage$/i) };
      options.forEach((option) => {
        const url = urls[option.getAttribute('data-platform')];
        if (url) option.setAttribute('href', url);
      });
    }
    if (pluginResult.status === 'fulfilled' && pluginResult.value.ok) {
      const plugin = await pluginResult.value.json();
      if (pluginVersion && plugin.version) pluginVersion.textContent = `v${plugin.version}`;
    }
  };
  void hydrateDownloads();
})();
