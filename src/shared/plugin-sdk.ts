// The `pidesk` API a plugin page talks to. Served by the app at pidesk-plugin://<id>/sdk/pidesk.js, so
// a plugin does not have to bundle it and every page speaks the same protocol.
//
// The page cannot reach the app's bridge: everything goes through postMessage to the window that
// embedded it, which checks the plugin's permissions before doing anything.
export const PLUGIN_SDK = `(function () {
  'use strict';
  var pending = new Map();
  var seq = 0;
  var listeners = new Map();
  var state = { session: null, theme: null };
  var ready;
  var readyPromise = new Promise(function (resolve) { ready = resolve; });

  function post(message) { parent.postMessage(message, '*'); }

  function on(kind, fn) {
    var set = listeners.get(kind) || new Set();
    listeners.set(kind, set);
    set.add(fn);
    return function () { set.delete(fn); };
  }

  function fire(kind, value) {
    var set = listeners.get(kind);
    if (set) set.forEach(function (fn) { fn(value); });
  }

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      post({ id: id, kind: 'call', method: method, args: args });
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data || {};
    if (data.kind === 'event') {
      var ev = data.event || {};
      if (ev.type === 'session') { state.session = ev.payload; fire('session', ev.payload); ready(); }
      else if (ev.type === 'theme') { state.theme = ev.payload; fire('theme', ev.payload); }
      else if (ev.type === 'data') fire('data:' + ev.name, ev.payload);
      return;
    }
    var waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    if (data.ok) waiting.resolve(data.value);
    else waiting.reject(new Error(data.error || 'The call failed.'));
  });

  window.pidesk = {
    ready: function () { return readyPromise; },
    session: {
      current: function () { return state.session; },
      onChange: function (fn) { var off = on('session', fn); if (state.session) fn(state.session); return off; },
      prompt: function (text) { return call('session.prompt', [String(text)]); }
    },
    host: {
      call: function (method) {
        return call('host.call', [String(method), Array.prototype.slice.call(arguments, 1)]);
      },
      on: function (name, fn) { return on('data:' + name, fn); }
    },
    storage: {
      get: function (key) { return call('storage.get', [String(key)]); },
      set: function (key, value) { return call('storage.set', [String(key), value]); }
    },
    notify: function (message) { return call('notify', [String(message)]); },
    theme: function () { return state.theme; },
    onTheme: function (fn) { var off = on('theme', fn); if (state.theme) fn(state.theme); return off; }
  };

  post({ kind: 'ready' });
})();
`;
