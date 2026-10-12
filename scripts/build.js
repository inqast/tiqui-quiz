import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  template: resolve(root, 'src', 'quiz.template.html'),
  player: resolve(root, 'src', 'player.js'),
  parser: resolve(root, 'src', 'parser.js'),
  app: resolve(root, 'src', 'app.js'),
  output: resolve(root, 'quiz.html'),
};

const [template, playerSource, parserSource, appSource] = await Promise.all([
  readFile(paths.template, 'utf8'),
  readFile(paths.player, 'utf8'),
  readFile(paths.parser, 'utf8'),
  readFile(paths.app, 'utf8'),
]);

function removeModuleSyntax(source) {
  return source
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '')
    .trim();
}

function indent(source) {
  return source.split('\n').map(line => `    ${line}`).join('\n');
}

const bundle = [playerSource, parserSource, appSource]
  .map(removeModuleSyntax)
  .join('\n\n');
const marker = '/*__TIQUI_BUNDLE__*/';

if (!template.includes(marker)) {
  throw new Error(`build marker ${marker} was not found in src/quiz.template.html`);
}

const output = template.replace(
  marker,
  `${indent("'use strict';")}\n${indent('// Generated from src/. Run make build after changing source files.')}\n${indent(bundle)}`,
);

if (process.argv.includes('--check')) {
  const current = await readFile(paths.output, 'utf8');
  if (current !== output) {
    console.error('quiz.html is out of date. Run: make build');
    process.exitCode = 1;
  } else {
    console.log('quiz.html is up to date');
  }
} else {
  await writeFile(paths.output, output);
  console.log('built quiz.html');
}
