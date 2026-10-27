import assert from 'node:assert/strict';
import test from 'node:test';

import { createStudentHtml } from '../../src/student-html.js';

const course = {
  id: 'course', title: '</script><script>globalThis.pwned=true</script>', icon: '🎓', description: '',
  lessons: [{ id: 'lesson', title: 'Тема', icon: '📘', media: { id: 'intro', kind: 'image', description: '<img src=x onerror=alert(1)>' }, questions: [] }]
};

test('creates deterministic offline HTML with inert data and safe relative media paths', () => {
  const paths = new Map([['intro', 'media/intro.png']]);
  const first = createStudentHtml(course, paths);
  const second = createStudentHtml(course, paths);

  assert.equal(first, second);
  assert.match(first, /<!doctype html>/i);
  assert.match(first, /media\/intro\.png/);
  assert.doesNotMatch(first, /<script>globalThis\.pwned/);
  assert.doesNotMatch(first, /<img src=x onerror/);
  assert.equal((first.match(/function createPlayer/g) || []).length, 1);
  assert.doesNotMatch(first, /answers\.json|CORRECT_ANSWERS|correctAnswers/);
});

test('rejects unsafe or unrelated student media paths', () => {
  for (const path of ['../secret.png', '/absolute.png', 'https://example.test/x.png', 'media/x.png?remote=1']) {
    assert.throws(() => createStudentHtml(course, new Map([['intro', path]])), /safe relative media path/i);
  }
});
