// One `pi --mode rpc` child process: strict JSONL framing, id-correlated
// responses, and every other record (events, extension UI requests) emitted
// as 'event'.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const fs = require('node:fs');

// pi runs as a separate Node process, so packaged builds point it at the unpacked copies.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// The package's "exports" hides dist/ and package.json, so find the package
// directory on the module search path and read its `bin` entry.
function findPiCli() {
  for (const dir of module.paths) {
    const pkg = path.join(dir, '@earendil-works', 'pi-coding-agent', 'package.json');
    if (fs.existsSync(pkg)) return unpacked(path.join(path.dirname(pkg), JSON.parse(fs.readFileSync(pkg, 'utf8')).bin.pi));
  }
  throw new Error('@earendil-works/pi-coding-agent is not installed');
}
const PI_CLI = findPiCli();
const EXTENSIONS_DIR = unpacked(path.join(__dirname, '..', 'extensions'));

class PiRpc extends EventEmitter {
  constructor({ cwd, args = [], env = {}, extensions = [] }) {
    super();
    this.cwd = cwd;
    this.extensions = extensions;
    this.args = args;
    this.env = env;
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.stderr = '';
  }

  start() {
    const extArgs = this.extensions.flatMap((p) => ['-e', p]);
    // Run pi with Electron's bundled Node (or plain node in tests).
    this.proc = spawn(process.execPath, [PI_CLI, '--mode', 'rpc', ...extArgs, ...this.args], {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env,
        ELECTRON_RUN_AS_NODE: '1',
        PI_DESKTOP_EXTENSIONS: this.extensions.join(path.delimiter),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8'); // decoder keeps multi-byte characters intact across chunks
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-20000);
      this.emit('stderr', d);
    });
    this.proc.on('exit', (code, signal) => {
      for (const { reject } of this.pending.values()) reject(new Error(`pi exited (${code ?? signal})`));
      this.pending.clear();
      this.proc = null;
      this.emit('exit', { code, signal, stderr: this.stderr });
    });
    this.proc.on('error', (err) => {
      // spawn failure (bad cwd, missing binary): surface it like an exit
      this.stderr += `\n${err.message}`;
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.proc = null;
      this.emit('exit', { code: null, signal: null, stderr: this.stderr, error: err.message });
    });
    this.proc.stdin.on('error', () => {}); // EPIPE after exit is reported via 'exit'
    return this;
  }

  // Split only on LF; Node's readline would also split on U+2028/U+2029 inside JSON strings.
  onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit('stderr', `[unparsed stdout] ${line}\n`);
        continue;
      }
      if (msg.type === 'response' && msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.success) resolve(msg.data);
        else reject(Object.assign(new Error(msg.error || `${msg.command} failed`), { command: msg.command }));
      } else {
        this.emit('event', msg);
      }
    }
  }

  get running() {
    return !!this.proc;
  }

  write(obj) {
    if (!this.proc) throw new Error('pi is not running');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  // Send a command and resolve with its response data.
  send(command) {
    const id = `d${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ ...command, id });
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  // Answer an extension_ui_request (no response record follows).
  uiResponse(id, payload) {
    this.write({ type: 'extension_ui_response', id, ...payload });
  }

  async stop() {
    if (!this.proc) return;
    const proc = this.proc;
    proc.stdin.end(); // orderly shutdown: pi exits when stdin closes
    await new Promise((resolve) => {
      const t = setTimeout(() => { proc.kill(); resolve(); }, 3000);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}

module.exports = { PiRpc, PI_CLI, EXTENSIONS_DIR };
