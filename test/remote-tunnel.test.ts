import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Tunnel } from '../src/agent/remote/tunnel';

const tunnels: Tunnel[] = [];
afterEach(() => {
  while (tunnels.length) tunnels.pop()!.stop();
});

function fake(body: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tunnel-')), 'fake.cjs');
  fs.writeFileSync(file, body);
  const tunnel = new Tunnel(process.env, [process.execPath, file]);
  tunnels.push(tunnel);
  return tunnel;
}

describe('cloudflare tunnel', () => {
  it('reads the public address from cloudflared output', async () => {
    const tunnel = fake("console.error('INF Requesting new quick Tunnel');console.error('https://quiet-river-1234.trycloudflare.com');setInterval(()=>{},1000)");
    expect(await tunnel.start(7431)).toEqual({ state: 'ready', url: 'https://quiet-river-1234.trycloudflare.com' });
    tunnel.stop();
    expect(tunnel.current.state).toBe('off');
  });

  it('reports a tunnel that dies before it is ready', async () => {
    const result = await fake("console.error('boom');process.exit(3)").start(7431);
    expect(result.state).toBe('error');
    expect(result.error).toContain('boom');
  });

  it('says so when cloudflared is not installed', async () => {
    const tunnel = new Tunnel(process.env, ['pi-no-such-cloudflared']);
    expect((await tunnel.start(7431)).error).toContain('not installed');
  });
});
