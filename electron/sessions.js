// Session hub: one pi RPC process per open session, session metadata,
// worktrees, CLI-session import, and a shared "probe" process for model lists.
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PiRpc, EXTENSIONS_DIR } = require('./pi-rpc');
const git = require('./git');
const naming = require('./naming');

const NAMES = ['trusting-maxwell', 'eager-lovelace', 'quiet-hopper', 'brave-turing', 'calm-knuth', 'swift-ritchie', 'bold-curie', 'keen-dijkstra'];
const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');
const COWORK_PROMPT = path.join(EXTENSIONS_DIR, 'cowork-prompt.md');

class SessionHub extends EventEmitter {
  constructor({ store, userData, getEnv }) {
    super();
    this.store = store;
    this.userData = userData;
    this.getEnv = getEnv; // extra env (API keys) for pi processes
    this.procs = new Map(); // sessionId -> PiRpc
    this.status = new Map(); // sessionId -> 'idle' | 'running'
    this.metas = store.get('sessions', []);
    this.probe = null;
    this.namers = new Set(); // throwaway naming processes, killed on quit
    this.extensions = [path.join(EXTENSIONS_DIR, 'desktop-kit', 'index.ts'), path.join(EXTENSIONS_DIR, 'demo-model.ts')];
  }

  save() {
    this.store.set('sessions', this.metas);
  }
  meta(id) {
    const m = this.metas.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown session ${id}`);
    return m;
  }
  list() {
    return this.metas.filter((m) => !m.archived).map((m) => ({ ...m, status: this.status.get(m.id) || 'idle' }));
  }

  baseArgs({ model, thinking, mode, kind, outputStyle }) {
    return [
      '--tools', '+grep,+find,+ls',
      '--desktop-mode', mode || 'auto',
      ...(outputStyle && outputStyle !== 'default' ? ['--desktop-output-style', outputStyle] : []),
      ...(kind === 'cowork' ? ['--desktop-profile', 'cowork', '--append-system-prompt', COWORK_PROMPT] : []),
      ...(model ? ['--model', model] : []),
      ...(thinking ? ['--thinking', thinking] : []),
    ];
  }

  // ------------------------------------------------------------ models / commands
  async getProbe() {
    if (this.probe?.running) return this.probe;
    this.probe = new PiRpc({ cwd: fs.existsSync(os.homedir()) ? os.homedir() : this.userData, extensions: this.extensions, env: this.getEnv(), args: ['--no-session', '--offline', ...this.baseArgs({})] }).start();
    this.probe.on('exit', () => (this.probe = null));
    return this.probe;
  }
  async models() {
    const probe = await this.getProbe();
    const [{ models }, state] = await Promise.all([probe.send({ type: 'get_available_models' }), probe.send({ type: 'get_state' })]);
    return { models, defaultModel: state.model ? `${state.model.provider}/${state.model.id}` : null };
  }
  async thinkingLevels(model) {
    const probe = await this.getProbe();
    if (model) {
      const [provider, ...rest] = model.split('/');
      await probe.send({ type: 'set_model', provider, modelId: rest.join('/') }).catch(() => {});
    }
    return (await probe.send({ type: 'get_available_thinking_levels' })).levels;
  }
  async restartProbe() {
    await this.probe?.stop();
    this.probe = null;
  }

  // A title passed by the caller is a user choice, unless the caller marks it as
  // a placeholder (`autoName: true`) standing in until the model names the session.
  titleState(title, autoName, fallback) {
    const custom = typeof title === 'string' && title.trim();
    const auto = autoName === true || !custom;
    return {
      title: custom || fallback,
      autoName: auto,
      titleLocked: Boolean(custom) && autoName !== true,
      autoNamed: false,
      nameAttempted: false,
    };
  }

  // ------------------------------------------------------------ lifecycle
  async create({ kind = 'code', projectPath, worktree = true, title, autoName, model, thinking, mode, outputStyle }) {
    const id = crypto.randomUUID();
    const slug = `${NAMES[Math.floor(Math.random() * NAMES.length)]}-${id.slice(0, 6)}`;
    if (kind === 'cowork') return this.createCowork({ id, slug, projectPath, title, autoName, model, thinking, mode, outputStyle });
    const root = await git.repoRoot(projectPath);
    const base = root ? await git.head(root) : null;
    let cwd = projectPath;
    let branch = root ? await git.currentBranch(root) : null;
    const baseBranch = branch;
    if (root && base && worktree) {
      branch = `claude/${slug}`;
      cwd = path.join(this.userData, 'worktrees', `${path.basename(root)}-${slug}`);
      await git.addWorktree(root, cwd, branch, base);
    }
    const meta = {
      id, kind: 'code', ...this.titleState(title, autoName, 'New session'),
      projectPath, cwd, branch, baseBranch, baseCommit: base,
      worktree: cwd !== projectPath, model, thinking, mode: mode || 'auto', outputStyle: outputStyle || 'default',
      sessionFile: null, createdAt: Date.now(), updatedAt: Date.now(), pr: null,
    };
    this.metas.unshift(meta);
    this.save();
    return meta;
  }

  // Cowork tasks run directly in the chosen folder (or a fresh scratch workspace); no worktree, no diff base.
  async createCowork({ id, slug, projectPath, title, autoName, model, thinking, mode, outputStyle }) {
    let cwd = projectPath;
    if (!cwd) {
      const day = new Date().toISOString().slice(0, 10);
      cwd = path.join(this.userData, 'cowork', `${day}-${slug}`);
      fs.mkdirSync(cwd, { recursive: true });
    }
    const meta = {
      id, kind: 'cowork', ...this.titleState(title, autoName, 'New task'),
      projectPath: cwd, cwd, scratch: !projectPath,
      branch: null, baseBranch: null, baseCommit: null, worktree: false, model, thinking, mode: mode || 'auto',
      outputStyle: outputStyle || 'default',
      sessionFile: null, createdAt: Date.now(), updatedAt: Date.now(), pr: null,
    };
    this.metas.unshift(meta);
    this.save();
    return meta;
  }

  ensure(id) {
    const live = this.procs.get(id);
    if (live?.running) return live;
    const m = this.meta(id);
    const args = [
      ...this.baseArgs(m),
      ...(m.sessionFile && fs.existsSync(m.sessionFile) ? ['--session', m.sessionFile] : ['--name', m.title]),
    ];
    const pi = new PiRpc({ cwd: m.cwd, extensions: this.extensions, env: this.getEnv(), args }).start();
    this.procs.set(id, pi);
    pi.on('event', (event) => {
      if (event.type === 'agent_start') this.setStatus(id, 'running');
      if (event.type === 'agent_settled') {
        this.setStatus(id, 'idle');
        m.updatedAt = Date.now();
        this.save();
      }
      if (event.type === 'session_info_changed' && event.name) {
        m.title = event.name;
        this.save();
      }
      if (event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === 'pi-desktop-mode') {
        m.mode = event.statusText;
        this.save();
      }
      if (event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === 'pi-desktop-output-style') {
        m.outputStyle = event.statusText;
        this.save();
      }
      this.emit('event', { sessionId: id, event });
    });
    pi.on('exit', ({ code, signal, stderr }) => {
      this.procs.delete(id);
      this.setStatus(id, 'idle');
      this.emit('exit', { sessionId: id, code, signal, stderr: stderr.slice(-4000) });
    });
    pi.ready = pi.send({ type: 'get_state' }).then((state) => {
      if (state.sessionFile && m.sessionFile !== state.sessionFile) {
        m.sessionFile = state.sessionFile;
        this.save();
      }
      return state;
    });
    return pi;
  }

  setStatus(id, s) {
    this.status.set(id, s);
    this.emit('status', { sessionId: id, status: s });
  }

  async open(id) {
    const pi = this.ensure(id);
    const state = await pi.ready;
    const [{ messages }, stats] = await Promise.all([
      pi.send({ type: 'get_messages' }),
      pi.send({ type: 'get_session_stats' }).catch(() => null),
    ]);
    return { meta: this.meta(id), state, messages, stats };
  }

  async prompt(id, message, behavior) {
    const pi = this.ensure(id);
    await pi.ready;
    const m = this.meta(id);
    m.updatedAt = Date.now();
    this.save();
    this.maybeNameFromPrompt(id, message);
    if (behavior === 'followUp') return pi.send({ type: 'follow_up', message }).catch(() => pi.send({ type: 'prompt', message }));
    const busy = this.status.get(id) === 'running';
    return pi.send({ type: 'prompt', message, ...(busy && !message.startsWith('/') ? { streamingBehavior: behavior || 'steer' } : {}) });
  }

  // First real user message: show it as the title immediately, then let a cheap
  // side model produce a better one. Both happen at most once per session.
  maybeNameFromPrompt(id, message) {
    const m = this.meta(id);
    const text = typeof message === 'string' ? message.trim() : '';
    if (!m.autoName || m.titleLocked || m.nameAttempted || !text || text.startsWith('/')) return;
    const placeholder = naming.titleFromPrompt(text);
    if (!placeholder) return;
    m.nameAttempted = true;
    this.save();
    this.setTitle(id, placeholder);
    this.nameSession(id, text).catch(() => {});
  }

  // Name generation runs in its own `pi --print` process: it never touches the
  // session's context or blocks the session's first turn.
  async nameSession(id, prompt) {
    const m = this.meta(id);
    if (!m.autoName || m.titleLocked || m.autoNamed) return;
    let models = [];
    let current = m.model || null;
    try {
      const pi = this.procs.get(id);
      if (pi?.running) {
        const [state, available] = await Promise.all([pi.ready, pi.send({ type: 'get_available_models' })]);
        if (state?.model) current = `${state.model.provider}/${state.model.id}`;
        models = available?.models || [];
      } else {
        const r = await this.models();
        models = r.models || [];
        current = current || r.defaultModel;
      }
    } catch {
      return; // keep the prompt as the title
    }
    const model = naming.pickNamingModel(models, current);
    if (!model) return; // demo/offline: there is no real model to ask
    const raw = await naming.generateName({
      prompt,
      model,
      cwd: m.cwd,
      env: this.getEnv(),
      register: (child) => {
        this.namers.add(child);
        child.once('close', () => this.namers.delete(child));
      },
    });
    const title = naming.cleanTitle(raw);
    const now = this.meta(id);
    // A rename that landed while the model was thinking wins.
    if (!title || now.titleLocked || !now.autoName || now.autoNamed || now.archived) return;
    now.autoNamed = true;
    this.save();
    this.setTitle(id, title);
  }

  // Persist a title and tell the renderer even when pi is not running.
  setTitle(id, title) {
    const m = this.meta(id);
    if (!title || m.title === title) return;
    m.title = title;
    this.save();
    const pi = this.procs.get(id);
    if (pi?.running) pi.send({ type: 'set_session_name', name: title }).catch(() => this.emitTitle(id, title));
    else this.emitTitle(id, title);
  }

  emitTitle(id, name) {
    this.emit('event', { sessionId: id, event: { type: 'session_info_changed', name } });
  }

  async rpc(id, command) {
    const pi = this.ensure(id);
    await pi.ready;
    return pi.send(command);
  }

  uiResponse(id, requestId, payload) {
    this.procs.get(id)?.uiResponse(requestId, payload);
  }

  async setMode(id, mode) {
    const m = this.meta(id);
    m.mode = mode;
    this.save();
    const pi = this.procs.get(id);
    if (pi?.running) await pi.send({ type: 'prompt', message: `/desktop-mode ${mode}` });
  }

  async setOutputStyle(id, style) {
    const m = this.meta(id);
    m.outputStyle = style;
    this.save();
    const pi = this.procs.get(id);
    if (pi?.running) await pi.send({ type: 'prompt', message: `/desktop-output-style ${style}` });
  }

  async update(id, patch) {
    const m = this.meta(id);
    const next = { ...patch };
    // A title set by the user is final: stop the placeholder/auto-naming path.
    if (next.title) Object.assign(next, { titleLocked: true, autoName: false });
    Object.assign(m, next);
    this.save();
    if (next.title && this.procs.get(id)?.running) await this.procs.get(id).send({ type: 'set_session_name', name: next.title }).catch(() => {});
    return m;
  }

  async archive(id) {
    await this.procs.get(id)?.stop();
    this.meta(id).archived = true;
    this.save();
  }

  async changes(id) {
    const m = this.meta(id);
    return git.changes(m.cwd, m.baseCommit);
  }

  async prStatus(id) {
    const m = this.meta(id);
    const pr = await git.prStatus(m.cwd);
    if (pr) {
      m.pr = { num: pr.num, url: pr.url, state: pr.state, draft: pr.draft };
      this.save();
    }
    return pr;
  }

  // ------------------------------------------------------------ CLI session import
  // Sessions created by the pi CLI for this project that the desktop does not know yet.
  importable(projectPath) {
    const known = new Set(this.metas.map((m) => m.sessionFile).filter(Boolean));
    const out = [];
    const walk = (dir, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 2) walk(p, depth + 1);
        else if (e.name.endsWith('.jsonl') && !known.has(p)) {
          const info = readSessionHeader(p);
          if (info && path.resolve(info.cwd) === path.resolve(projectPath)) out.push({ file: p, ...info });
        }
      }
    };
    walk(PI_SESSIONS, 0);
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  async importSession(file) {
    const info = readSessionHeader(file);
    if (!info) throw new Error('Not a pi session file');
    const root = await git.repoRoot(info.cwd);
    const meta = {
      id: crypto.randomUUID(), title: info.name || info.firstPrompt?.slice(0, 60) || 'Imported session',
      projectPath: info.cwd, cwd: info.cwd, branch: root ? await git.currentBranch(root) : null, baseBranch: null,
      baseCommit: root ? await git.head(root) : null, worktree: false, mode: 'auto', outputStyle: 'default', sessionFile: file,
      createdAt: info.mtime, updatedAt: info.mtime, pr: null, imported: true,
    };
    this.metas.unshift(meta);
    this.save();
    return meta;
  }

  async stopAll() {
    for (const child of this.namers) { try { child.kill(); } catch {} }
    this.namers.clear();
    await Promise.all([...this.procs.values()].map((p) => p.stop()));
    await this.probe?.stop();
  }
}

function readSessionHeader(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    if (header.type !== 'session' || !header.cwd) return null;
    let firstPrompt = null, name = null;
    for (const line of lines.slice(1, 400)) {
      const e = JSON.parse(line);
      if (e.type === 'session_info' && e.name) name = e.name;
      if (!firstPrompt && e.type === 'message' && e.message?.role === 'user') {
        const c = e.message.content;
        firstPrompt = typeof c === 'string' ? c : (c || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
      }
    }
    return { cwd: header.cwd, id: header.id, name, firstPrompt, mtime: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

module.exports = { SessionHub };
