#!/usr/bin/env node
// Offline substitutes for GitHub CLI and the SSH transport, not the app's RPCs or Git worktree commands.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const home = process.env.PR_DEMO_HOME;
const repo = process.env.PR_DEMO_REPO;
const repository = path.join(home, 'remote.git');
const [a, b, c, d] = process.argv.slice(2);

function waitForRelease(stage) {
  const gate = path.join(home, `release-${stage}`);
  if (fs.existsSync(gate)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fs.unwatchFile(gate);
      reject(new Error(`Timed out waiting for demo stage: ${stage}`));
    }, 30_000);
    fs.watchFile(gate, { interval: 50 }, (stat) => {
      if (!stat.nlink) return;
      clearTimeout(timer);
      fs.unwatchFile(gate);
      resolve();
    });
  });
}

async function main() {
  if (path.basename(process.argv[1]) === 'pr-demo-ssh') {
    if (a !== 'git@github.com' || b !== `git-upload-pack '${repo}.git'`)
      throw new Error('Unexpected SSH destination for the offline demo');
    await waitForRelease('fetch');
    execFileSync('git', ['upload-pack', repository], { stdio: 'inherit' });
  } else if (a === 'api' && b === '--hostname' && c === 'github.com') {
    await waitForRelease('read');
    const pull = `repos/${repo}/pulls/`;
    if (d === `${pull}43`) console.log(JSON.stringify({ state: 'closed' }));
    else if (d === `${pull}42`)
      console.log(
        JSON.stringify({
          title: 'Demo PR progress',
          state: 'open',
          base: { ref: 'main' },
          head: { ref: 'feature', repo: { full_name: repo } },
        }),
      );
    else throw new Error('Unexpected PR for the offline demo');
  } else if (a === 'repo' && b === 'clone' && c === `https://github.com/${repo}` && d) {
    await waitForRelease('clone');
    execFileSync('git', ['clone', '--', repository, d], { stdio: 'inherit' });
    execFileSync('git', ['-C', d, 'remote', 'set-url', 'origin', `git@github.com:${repo}.git`]);
  } else {
    // Branch/CI watchers need no live GitHub data in this demo.
    throw new Error('GitHub command not available in the offline demo');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
