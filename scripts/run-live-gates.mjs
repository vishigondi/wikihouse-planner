// Self-contained live-gate runner.
//
// Boots ONE production server, points both live gates at it, runs them, and
// tears the server down — so the live half of the ladder is a single command
// (`npm run gates:live`) instead of a remembered "start prod on 3000, start
// dev on 3002, then run two scripts" ritual. The prod build serves the same
// interactive app, so qa:brochure (BROCHURE_QA_URL) and the interactive sweep
// (SWEEP_URL) can both target it.
//
// Usage: npm run gates:live   (or `npm run gates:all` for the whole ladder)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

const PORT = process.env.LIVE_GATE_PORT || '3000';
const ORIGIN = `http://127.0.0.1:${PORT}`;

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts });
// Kill ONLY the listener on the port. `lsof -ti:PORT` also matches client
// sockets (this runner and Chromium hold connections to it), so an unfiltered
// kill -9 would take down the test process itself — `-sTCP:LISTEN -a` scopes
// it to the server alone.
const freePort = () => {
  try { spawnSync('bash', ['-lc', `lsof -ti:${PORT} -a -sTCP:LISTEN | xargs kill -9 2>/dev/null`], { stdio: 'ignore' }); } catch {}
};

// A production server needs a build. Build if one isn't present so the runner
// works standalone; `gates:all` will already have built.
if (!existsSync('.next/BUILD_ID')) {
  console.log('[live-gates] no build found — running `npm run build` first');
  const build = run('npm', ['run', 'build']);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

freePort();
console.log(`[live-gates] starting production server on ${PORT}`);
const server = spawn('npx', ['next', 'start', '-p', PORT], { detached: true, stdio: 'ignore' });

let toreDown = false;
const shutdown = () => {
  if (toreDown) return;
  toreDown = true;
  // Kill the npx wrapper, then the actual listener (next) by port. Avoid a
  // negative-pid process-group kill — if detachment is unreliable it can take
  // down this runner's own group.
  try { server.kill('SIGTERM'); } catch {}
  freePort();
};
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });
process.on('SIGTERM', () => { shutdown(); process.exit(143); });

const waitReady = async (timeoutMs = 90000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(ORIGIN, (res) => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

if (!(await waitReady())) {
  console.error('[live-gates] server did not become ready in time');
  shutdown();
  process.exit(1);
}
console.log('[live-gates] server ready — running live gates against', ORIGIN);

const env = { ...process.env, BROCHURE_QA_URL: ORIGIN, SWEEP_URL: ORIGIN };
const qa = run('npm', ['run', 'qa:brochure'], { env });
const sweep = run('npm', ['run', 'verify'], { env });

shutdown();

const failed = (qa.status ?? 1) !== 0 || (sweep.status ?? 1) !== 0;
if (failed) {
  console.error(`[live-gates] FAILED — qa:brochure exit ${qa.status}, sweep exit ${sweep.status}`);
  process.exit(1);
}
console.log('[live-gates] all live gates green');
