# @pi-desktop/plugin-example

A [Pi Desktop](../../docs/plugins.md) plugin: one sidebar page, and a host entry that answers it.

| File | |
|---|---|
| `package.json` | the `piDesktop` section: id, permissions, the host entry and the page |
| `host.js` | runs in the agent host; answers `pidesk.host.call` and pushes data with `desktop.emit` |
| `ui/` | the page itself, in a sandboxed iframe served from `pidesk-plugin://example/` |

## Try it

```bash
# From the Pi Desktop repo: install the folder as a personal package.
# Then Customize → Plugins → expand it → Desktop → turn it on.
```

The page shows the open session, calls the host (a counter kept in the plugin's own storage), and can
send a message to the session. Turning the plugin off removes the page from the sidebar; the plugin's
code stays loaded until the app restarts.

## What a page may do

Only what the manifest's `permissions` say. Each call is checked in the window that embeds the page
and again in the agent host; anything else is refused with an error the page sees as a rejected
promise. See `docs/plugins.md` for the API and the permission list.
