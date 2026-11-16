// The plugin's own code, running in the agent host (not in a window). It answers the calls its page
// makes with `pidesk.host.call`, pushes data back with `desktop.emit`, and keeps a counter in its
// private storage. Nothing here runs in the main process or in the page.
export default function activate(desktop) {
  let count = Number(desktop.storage.get('count') ?? 0) || 0;

  desktop.handle('greet', (name) => {
    count += 1;
    desktop.storage.set('count', count);
    desktop.emit('count', count);
    return { greeting: `Hello, ${name || 'world'}!`, count };
  });

  desktop.handle('count', () => count);
}
