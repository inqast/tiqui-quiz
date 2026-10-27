import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const zipRoot = resolve(dirname(require.resolve('fflate')), '..');
const zipSource = (await readFile(resolve(zipRoot, 'umd', 'index.js'), 'utf8')).trim();
const paths = {
  template: resolve(root, 'src', 'quiz.template.html'),
  player: resolve(root, 'src', 'player.js'),
  parser: resolve(root, 'src', 'parser.js'),
  mediaRegistry: resolve(root, 'src', 'media-registry.js'),
  coursePackage: resolve(root, 'src', 'course-package.js'),
  studentHtml: resolve(root, 'src', 'student-html.js'),
  app: resolve(root, 'src', 'app.js'),
  output: resolve(root, 'quiz.html'),
};

const [template, playerSource, parserSource, mediaRegistrySource, coursePackageSource, studentHtmlSource, appSource] = await Promise.all([
  readFile(paths.template, 'utf8'),
  readFile(paths.player, 'utf8'),
  readFile(paths.parser, 'utf8'),
  readFile(paths.mediaRegistry, 'utf8'),
  readFile(paths.coursePackage, 'utf8'),
  readFile(paths.studentHtml, 'utf8'),
  readFile(paths.app, 'utf8'),
]);

function removeModuleSyntax(source) {
  return source
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '')
    .trim();
}

function indent(source) {
  return source.split('\n').map(line => line ? `    ${line}` : '').join('\n');
}

const zipLicense = (await readFile(resolve(zipRoot, 'LICENSE'), 'utf8')).trim();
const projectBundle = [playerSource, parserSource, mediaRegistrySource, coursePackageSource, studentHtmlSource, appSource]
  .map(removeModuleSyntax)
  .join('\n\n');
const bundle = `/* fflate (MIT)\n${zipLicense}\n*/\n${zipSource}\n\n${projectBundle}`;
const marker = '/*__TIQUI_BUNDLE__*/';

if (!template.includes(marker)) {
  throw new Error(`build marker ${marker} was not found in src/quiz.template.html`);
}

const output = template.replace(
  marker,
  () => `${indent("'use strict';")}\n${indent('// Generated from src/ and the fflate UMD bundle. Run make build after changing inputs.')}\n${indent(bundle)}`,
);

if (process.argv.includes('--check')) {
  const current = await readFile(paths.output, 'utf8');
  assert.equal(current.split(indent(zipSource)).length - 1, 1, 'quiz.html must contain the ZIP adapter exactly once');
  assert.doesNotMatch(current, /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]fflate(?:\/[^'"]*)?['"]/,
    'quiz.html must not contain an unresolved bare fflate import');
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
