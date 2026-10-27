import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaTemplateError, removeMediaBlock, upsertMediaBlock } from '../../src/media-template.js';
import { parseDocument } from '../../src/parser.js';

const media = { id: 'intro-video', kind: 'video', description: 'Введение в тему' };

test('inserts lesson media canonically after existing lesson metadata', () => {
  const source = '# Курс\n\n## Тема\nИконка: 🌌\nОписание: О планетах\nID: planets\n\n### Ввод\nВопрос?\nОтветы: ответ';

  assert.equal(upsertMediaBlock(source, { line: 2, scope: 'lesson', heading: '## Тема' }, media),
    '# Курс\n\n## Тема\nИконка: 🌌\nОписание: О планетах\nID: planets\nМедиа: video:intro-video\nОписание медиа: Введение в тему\n\n### Ввод\nВопрос?\nОтветы: ответ');
});

test('inserts question media directly after its heading', () => {
  const source = '# Курс\n\n## Тема\n\n### Ввод\n\nВопрос?\nОтветы: ответ';

  assert.equal(upsertMediaBlock(source, { line: 4, scope: 'question', heading: '### Ввод' }, media),
    '# Курс\n\n## Тема\n\n### Ввод\nМедиа: video:intro-video\nОписание медиа: Введение в тему\n\nВопрос?\nОтветы: ответ');
});

test('replaces an existing media block without duplicating either field', () => {
  const source = '# Курс\n\n## Тема\nОписание медиа: Старое описание\nМедиа: image:old-image\n\n### Ввод\nВопрос?\nОтветы: ответ';

  const result = upsertMediaBlock(source, { line: 2, scope: 'lesson', heading: '## Тема' }, media);

  assert.equal(result.match(/^Медиа:/gm)?.length, 1);
  assert.equal(result.match(/^Описание медиа:/gm)?.length, 1);
  assert.match(result, /Медиа: video:intro-video\nОписание медиа: Введение в тему/);
  assert.doesNotMatch(result, /old-image|Старое описание/);
});

test('removes both media fields while preserving unrelated whitespace and content', () => {
  const source = '# Курс\n\n## Тема\nИконка: 🌌\nМедиа: audio:intro\nОписание медиа: Вступление\n\n\n### Ввод\nВопрос?\nОтветы: ответ\n';

  assert.equal(removeMediaBlock(source, { line: 2, scope: 'lesson', heading: '## Тема' }),
    '# Курс\n\n## Тема\nИконка: 🌌\n\n\n### Ввод\nВопрос?\nОтветы: ответ\n');
});

test('normalizes CRLF consistently with the parser', () => {
  const source = '# Курс\r\n\r\n## Тема\r\n\r\n### Ввод\r\nВопрос?\r\nОтветы: ответ\r\n';

  const result = upsertMediaBlock(source, { line: 4, scope: 'question', heading: '### Ввод' }, media);

  assert.equal(result.includes('\r'), false);
  assert.match(result, /### Ввод\nМедиа: video:intro-video\nОписание медиа: Введение в тему/);
});

test('refuses stale or mismatched source anchors', () => {
  const source = '# Курс\n\n## Тема\n\n### Ввод\nВопрос?\nОтветы: ответ';

  assert.throws(
    () => upsertMediaBlock(source, { line: 4, scope: 'lesson' }, media),
    error => error instanceof MediaTemplateError && error.code === 'STALE_ANCHOR'
  );
  assert.throws(
    () => removeMediaBlock(source, { line: 99, scope: 'question' }),
    error => error instanceof MediaTemplateError && error.code === 'STALE_ANCHOR'
  );
});

test('rejects a parser anchor after its owner heading is replaced at the same line', () => {
  const original = '# Курс\n\n## Старая тема\n\n### Ввод\nВопрос?\nОтветы: ответ';
  const changedLesson = original.replace('## Старая тема', '## Новая тема');
  const changedQuestion = original.replace('### Ввод', '### Выбор');
  const parsed = parseDocument(original);
  const lessonAnchor = parsed.course.lessons[0].anchor;
  const questionAnchor = parsed.course.lessons[0].questions[0].anchor;

  assert.deepEqual(lessonAnchor, { line: 2, scope: 'lesson', heading: '## Старая тема' });
  assert.deepEqual(questionAnchor, { line: 4, scope: 'question', heading: '### Ввод' });
  assert.throws(
    () => upsertMediaBlock(changedLesson, lessonAnchor, media),
    error => error instanceof MediaTemplateError && error.code === 'STALE_ANCHOR'
  );
  assert.throws(
    () => removeMediaBlock(changedQuestion, questionAnchor),
    error => error instanceof MediaTemplateError && error.code === 'STALE_ANCHOR'
  );
});
