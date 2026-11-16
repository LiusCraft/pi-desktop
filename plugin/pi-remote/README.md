# pi-remote

A [pi](https://github.com/earendil-works/pi) extension that serves pi sessions to a remote **Pi Desktop**.
Install it on a machine that has only the pi CLI; control it from Pi Desktop on another machine.

```bash
pi install npm:@liuscraft/pi-remote                # from a checkout: pi install /path/to/pi-desktop/plugin/pi-remote
```

In pi:

| Command | |
|---|---|
| `/remote start [--lan] [--port N]` | Start serving (default `127.0.0.1:7431`). `--lan` listens on every interface. |
| `/remote status` | Address, token and number of connected clients. |
| `/remote token` / `rotate` | Show the access token / replace it (disconnects clients). |
| `/remote stop` | Stop serving. |

`pi --remote` starts serving as soon as pi starts. In Pi Desktop open **Settings → Remote → Connect to a remote**
and enter the address and token.

Sessions run inside the pi process, sharing pi's logins (`auth.json`) and models. State lives in `~/.pi-remote`
(`PI_REMOTE_HOME` overrides it). When pi exits, serving stops.

**The token is full control of this machine** (sessions run shell commands). The connection is plain HTTP:
keep the default loopback binding behind an SSH tunnel or a VPN, and never expose the port to the internet.

This package is a build of `src/agent/remote/plugin.ts` (`npm run build:plugin` in the Pi Desktop repo).
It is published from the same tag as Pi Desktop itself, so its version matches the app it was built for; the
two ends compare a protocol version when they connect and refuse a mismatched pair with a message saying
which side to update.
