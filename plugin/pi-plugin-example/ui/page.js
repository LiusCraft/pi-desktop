// The page's side of the example: everything here goes through `pidesk`, which posts to the window
// that embedded this page. Nothing in this file can reach the app's files, the bridge, or the network.
const $ = (id) => document.getElementById(id);

/** The app's colours, so the page looks like part of it. */
pidesk.onTheme((theme) => {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme)) {
    if (name.startsWith('--')) root.style.setProperty(name, value);
  }
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
});

function showSession(session) {
  $('session').textContent = session ? `${session.title} · ${session.kind}` : 'No session open';
  $('prompt').disabled = !session;
}

pidesk.session.onChange(showSession);
pidesk.ready().then(() => showSession(pidesk.session.current()));

pidesk.host.on('count', (count) => {
  $('count').textContent = String(count);
});
pidesk.host.call('count').then((count) => {
  $('count').textContent = String(count);
}).catch((err) => {
  $('out').textContent = String(err.message ?? err);
});

$('greet').addEventListener('click', async () => {
  try {
    const result = await pidesk.host.call('greet', $('name').value);
    $('out').textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    $('out').textContent = String(err.message ?? err);
  }
});

$('prompt').addEventListener('click', async () => {
  try {
    await pidesk.session.prompt('Hello from the example plugin.');
    pidesk.notify('Sent a message to the session.');
  } catch (err) {
    $('out').textContent = String(err.message ?? err);
  }
});

// What the user typed last time lives in the plugin's own storage, not the app's.
pidesk.storage.get('name').then((name) => {
  if (typeof name === 'string') $('name').value = name;
}).catch(() => {});
$('name').addEventListener('change', () => {
  pidesk.storage.set('name', $('name').value).catch(() => {});
});
