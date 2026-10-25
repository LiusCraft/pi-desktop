// Shared attachment inputs and session-owned drafts. No clipboard polling or remote fetches.
(() => {
  const A = window.PiAttachments;
  const esc = (s) => window.CC.esc(String(s ?? ''));
  const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const fileIcon = '<svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 2.5h6l4 4V17H5zM11 2.5V7h4"/></svg>';
  const sizeLabel = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  function tiles(attachments, removable = false) {
    return (attachments || []).map((a, i) => {
      const src = a.kind === 'image' && A.imageSource(a);
      return `<div class="attachment-tile ${src ? 'is-image' : 'is-file'}${a.missing ? ' missing' : ''}">
        <button type="button" class="attachment-preview" data-preview="${i}" title="${esc(a.path || a.name)}" aria-label="${esc(a.kind === 'image' ? `Preview ${a.name}` : a.name)}">${src ? `<img src="${src}" alt="${esc(a.name)}">` : fileIcon}<span class="attachment-caption"><span>${esc(a.name)}</span><small>${a.missing ? 'Image unavailable' : esc(a.kind === 'file' ? 'Local file · ' + sizeLabel(a.size) : sizeLabel(a.size))}</small></span></button>
        ${removable ? `<button type="button" class="attachment-remove" data-remove="${i}" aria-label="${esc(`Remove ${a.name}`)}" title="Remove attachment">×</button>` : ''}</div>`;
    }).join('');
  }
  function preview(a) {
    const src = A.imageSource(a);
    if (!src) {
      window.CC.toast(a.kind === 'file' ? `${a.path}\nLocal reference; moving or deleting this file makes it unavailable.` : 'Image unavailable');
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'attachment-dialog';
    dialog.innerHTML = `<div class="attachment-dialog-head"><span>${esc(a.name)}</span><button type="button" aria-label="Close preview">×</button></div><img src="${src}" alt="${esc(a.name)}">`;
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('button').onclick = close;
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  }
  function wireGallery(root, attachments) {
    root.querySelectorAll('[data-preview]').forEach((b) => { b.onclick = () => preview(attachments[+b.dataset.preview]); });
  }
  function plainHTML(html) {
    // A template stays inert: it cannot load clipboard images or execute scripts.
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((e) => e.remove());
    const block = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'PRE', 'BLOCKQUOTE']);
    const text = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
      if (node.nodeName === 'BR') return '\n';
      let s = [...node.childNodes].map(text).join('');
      if (node.nodeName === 'TD' || node.nodeName === 'TH') s += '\t';
      if (block.has(node.nodeName) && !s.endsWith('\n')) s += '\n';
      return s;
    };
    return text(template.content);
  }
  function create({ api, onChange }) {
    const drafts = new Map();
    const code = document.querySelector('#codeInput'), cowork = document.querySelector('#input');
    const racks = { code: document.querySelector('#codeAttachments'), cowork: document.querySelector('#attachments') };
    let active = null, view = 'code';
    const input = () => view === 'cowork' ? cowork : code;
    const draft = (key) => {
      if (!drafts.has(key)) drafts.set(key, { key, text: '', attachments: [], revision: 0, preparing: 0, sending: false, errors: [], recoveries: [] });
      return drafts.get(key);
    };
    function sync() {
      if (!active) return null;
      const d = draft(active);
      if (d.text !== input().value) { d.text = input().value; d.revision++; }
      return d;
    }
    function render() {
      if (!active) return;
      const d = draft(active), el = input(), rack = racks[view];
      el.readOnly = d.sending;
      if (el.value !== d.text) el.value = d.text;
      rack.innerHTML = `<div class="attachment-strip">${tiles(d.attachments, true)}</div>${d.preparing ? '<div class="attachment-status" role="status">Preparing attachments…</div>' : ''}${d.errors.length ? `<div class="attachment-error" role="alert">${d.errors.map(esc).join('<br>')}<button type="button" data-dismiss aria-label="Dismiss attachment errors">×</button></div>` : ''}${d.recoveries.length ? `<div class="draft-recoveries">${d.recoveries.map((s, i) => `<div><span>${esc(s.label || (s.text.trim().slice(0, 65) || s.attachments[0]?.name || 'Unsent message'))}</span><button type="button" data-restore="${i}">Restore</button><button type="button" data-discard="${i}">Discard</button></div>`).join('')}</div>` : ''}`;
      rack.hidden = !d.attachments.length && !d.preparing && !d.errors.length && !d.recoveries.length;
      wireGallery(rack, d.attachments);
      rack.querySelectorAll('[data-remove]').forEach((b) => {
        b.disabled = d.sending;
        b.onclick = () => { d.attachments.splice(+b.dataset.remove, 1); d.revision++; render(); };
      });
      rack.querySelector('[data-dismiss]')?.addEventListener('click', () => { d.errors = []; render(); });
      rack.querySelectorAll('[data-restore]').forEach((b) => { b.disabled = d.sending; b.onclick = () => {
        sync();
        if (d.text.trim() || d.attachments.length) return window.CC.toast('Clear or send the current draft before restoring this message');
        const [s] = d.recoveries.splice(+b.dataset.restore, 1);
        d.text = s.text; d.attachments = s.attachments.slice(); d.revision++; render(); el.focus();
      }; });
      rack.querySelectorAll('[data-discard]').forEach((b) => { b.onclick = () => { d.recoveries.splice(+b.dataset.discard, 1); render(); }; });
      document.querySelector(view === 'cowork' ? '#attachBtn' : '#codeAttach').disabled = d.sending;
      onChange?.(d);
    }
    function activate(key, nextView = 'code') {
      sync();
      active = key; view = nextView;
      render();
    }
    function refresh(d) { if (d?.key === active) render(); }
    function error(d, err) { d.errors.push(cleanError(err)); refresh(d); }
    function insert(d, text, selection) {
      if (!text) return;
      const [start, end] = selection || [d.text.length, d.text.length];
      d.text = d.text.slice(0, start) + text + d.text.slice(end); d.revision++;
      if (d.key === active) {
        input().value = d.text;
        input().setSelectionRange(start + text.length, start + text.length);
      }
      refresh(d);
    }
    function accept(d, result) {
      const existing = new Set(d.attachments.map((a) => a.path || `${a.mimeType}:${a.data}`));
      const incoming = (result?.attachments || []).filter((a) => {
        const k = a.path || `${a.mimeType}:${a.data}`;
        if (existing.has(k)) return false;
        existing.add(k); return true;
      });
      try { A.validateAttachments([...d.attachments, ...incoming]); if (incoming.length) { d.attachments.push(...incoming); d.revision++; } }
      catch (err) { error(d, err); }
      for (const e of result?.errors || []) error(d, e.name ? `${e.name}: ${e.message}` : e.message || e);
      refresh(d);
    }
    async function prepare(d, work) {
      if (d.sending) return;
      d.preparing++; refresh(d);
      try { return await work(); } catch (err) { error(d, err); }
      finally { d.preparing--; refresh(d); }
    }
    async function sources(files) {
      if (files.length > A.LIMITS.count) throw new Error(`Choose at most ${A.LIMITS.count} attachments`);
      if (files.reduce((n, f) => n + f.size, 0) > A.LIMITS.sourceBytes) throw new Error('Attachments exceed the total size limit');
      return Promise.all(files.map(async (file) => {
        const path = api.getPathForFile?.(file);
        if (path) return { path };
        if (!file.type.startsWith('image/')) throw new Error(`${file.name}: this clipboard file has no local path; save it and select it instead`);
        if (file.size > A.LIMITS.fileBytes) throw new Error(`${file.name}: image exceeds 20 MB`);
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onerror = () => reject(new Error(`Cannot read ${file.name}`));
          r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(file);
        });
        return { name: file.name || 'Screenshot.png', mimeType: file.type, data };
      }));
    }
    function acceptPaste(d, result, text, selection, revision) {
      const unchanged = d.revision === revision;
      accept(d, result);
      if (!text) return;
      if (unchanged) insert(d, text, selection);
      else { d.recoveries.push({ text, attachments: [], label: 'Pasted text' }); refresh(d); }
    }
    function importFiles(d, files, pasted) {
      return prepare(d, async () => {
        let result;
        try { result = await api.invoke('attachments:import', await sources(files)); }
        finally {
          // Even a failed image import must not discard the accompanying caption.
          if (pasted) acceptPaste(d, result, pasted.text, pasted.selection, pasted.revision);
        }
        if (!pasted) accept(d, result);
      });
    }
    function paste(e) {
      const d = sync();
      if (!d || d.sending) { e.preventDefault(); return; }
      const data = e.clipboardData;
      if (!data) return;
      const files = [...data.files], types = [...data.types];
      const text = data.getData('text/plain'), html = data.getData('text/html');
      const selection = [e.target.selectionStart, e.target.selectionEnd];
      const revision = d.revision;
      if (files.length) {
        e.preventDefault();
        const localFiles = files.some((f) => api.getPathForFile?.(f)) || types.some((t) => /uri-list|gnome-copied-files|file-url|FileName|CF_HDROP/i.test(t));
        importFiles(d, files, { text: localFiles ? '' : text || (html ? plainHTML(html) : ''), selection, revision });
        return;
      }
      const native = types.some((t) => /uri-list|gnome-copied-files|file-url|osclipboard|FileName|CF_HDROP|Files/i.test(t));
      // Preserve the browser's native paste, selection and undo for ordinary text.
      if (text && !native) return;
      if (html && !native) { e.preventDefault(); insert(d, plainHTML(html), selection); return; }
      e.preventDefault();
      prepare(d, async () => {
        const result = await api.invoke('attachments:clipboard');
        const fallback = result?.hasFiles ? '' : result?.text || text || (html ? plainHTML(html) : '');
        acceptPaste(d, result, fallback, selection, revision);
        if (!fallback && !result?.attachments?.length && !result?.errors?.length) error(d, 'No supported image, file or text found in the clipboard');
      });
    }
    for (const [el, kind] of [[code, 'code'], [cowork, 'cowork']]) {
      el.addEventListener('input', () => { if (view === kind) { sync(); onChange?.(draft(active)); } });
      el.addEventListener('paste', paste);
      const box = el.closest(kind === 'code' ? '.cx-box' : '.cw-box');
      box.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('drag-over'); } });
      box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drag-over'); });
      box.addEventListener('drop', (e) => {
        box.classList.remove('drag-over');
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault(); const d = sync(); if (d && !d.sending) importFiles(d, files);
      });
    }
    return {
      activate, current: sync, refresh, error, insert,
      pick() { const d = sync(); if (d) return prepare(d, async () => accept(d, await api.invoke('attachments:pick'))); },
      snapshot(d) { return { text: d.text, attachments: d.attachments.slice() }; },
      lock(d, value) { d.sending = value; refresh(d); },
      clear(d) { d.text = ''; d.attachments = []; d.errors = []; d.revision++; refresh(d); },
      rekey(d, key) { const wasActive = active === d.key; drafts.delete(d.key); d.key = key; drafts.set(key, d); if (wasActive) active = key; },
      isActive(d) { return active === d.key; },
      recover(key, s) {
        const d = draft(key);
        if (key === active) sync();
        if (!d.text.trim() && !d.attachments.length && !d.sending && !d.preparing) { d.text = s.text; d.attachments = s.attachments.slice(); d.revision++; }
        else d.recoveries.push(s);
        refresh(d);
      },
    };
  }
  window.PiComposer = { create, tiles, wireGallery, preview, plainHTML };
})();
