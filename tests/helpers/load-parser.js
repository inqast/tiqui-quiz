import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function loadParser() {
  const html = await readFile(new URL('../../quiz.html', import.meta.url), 'utf8');
  const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

  if (scriptBlocks.length !== 1) {
    throw new Error(`expected one script block, found ${scriptBlocks.length}`);
  }

  const marker = 'const source = document.querySelector';
  const parserSource = scriptBlocks[0][1].split(marker)[0];
  const context = {
    document: {
      createElement: () => ({}),
      head: { append: () => {} },
    },
  };

  vm.createContext(context);
  vm.runInContext(parserSource, context);

  if (typeof context.parseDocument !== 'function') {
    throw new Error('parseDocument was not found in quiz.html');
  }

  return context.parseDocument;
}

export async function loadStarter() {
  const html = await readFile(new URL('../../quiz.html', import.meta.url), 'utf8');
  const match = html.match(/const starter = `([\s\S]*?)`;\n/);

  if (!match) throw new Error('starter document was not found in quiz.html');
  return match[1];
}
