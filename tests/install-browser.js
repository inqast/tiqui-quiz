import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cli = resolve('node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: resolve('.playwright-browsers'),
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
