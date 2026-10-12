import { readFile } from 'node:fs/promises';

export async function loadStarter() {
  const app = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
  const match = app.match(/const starter = `([\s\S]*?)`;\n/);

  if (!match) throw new Error('starter document was not found in src/app.js');
  return match[1];
}
