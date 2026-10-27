import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';
import * as fflate from 'fflate';

import { createCoursePackage } from '../../src/course-package.js';
import { createMediaRegistry } from '../../src/media-registry.js';
import { createStudentHtml } from '../../src/student-html.js';

class LocalFile extends Blob {
  constructor(parts, name, options) { super(parts, options); this.name = name; this.lastModified = 0 }
}

const digest = (_algorithm, bytes) => Promise.resolve(createHash('sha256').update(bytes).digest().buffer);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

test('boots exported student ZIP from file URL with offline relative media', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'tiqui-student-'));
  try {
    const hostile = '</script><script>window.__studentXss=true</script>';
    const lessonMedia = { id: 'intro', kind: 'image', description: hostile };
    const questionMedia = { id: 'question', kind: 'image', description: 'Изображение вопроса' };
    const course = { id: 'offline', title: hostile, icon: '🎓', description: '', lessons: [{ id: 'lesson', title: 'Тема', icon: '📘', media: lessonMedia, questions: [{ type: 'tf', text: 'Вопрос', media: questionMedia, answer: true }] }] };
    const registry = createMediaRegistry();
    registry.attach(lessonMedia, new LocalFile([png], 'intro.png', { type: 'image/png' }));
    registry.attach(questionMedia, new LocalFile([png], 'question.png', { type: 'image/png' }));
    const html = createStudentHtml(course, new Map([['intro', 'media/intro.png'], ['question', 'media/question.png']]));
    const exported = await createCoursePackage(fflate, { digest }).exportStudentCourse({ course, registry, indexHtml: html });
    expect(exported.ok).toBe(true);
    const entries = fflate.unzipSync(new Uint8Array(await exported.value.arrayBuffer()));
    for (const [name, bytes] of Object.entries(entries)) {
      const path = join(directory, name);
      if (name.includes('/')) await mkdir(join(directory, name.split('/')[0]), { recursive: true });
      await writeFile(path, bytes);
    }
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(pathToFileURL(join(directory, 'index.html')).href);
    await expect(page.locator('.lesson-btn')).toBeVisible();
    await page.locator('.lesson-btn').click();
    await expect(page.locator('.media-intro img')).toHaveAttribute('src', 'media/intro.png');
    await expect(page.locator('.media-intro figcaption')).toHaveText(hostile);
    await page.getByRole('button', { name: 'Перейти к вопросам' }).click();
    await expect(page.locator('.question-media img')).toHaveAttribute('src', 'media/question.png');
    await expect(page.getByRole('button', { name: /^\d+ Правда$/ })).toBeVisible();
    expect(await page.evaluate(() => window.__studentXss)).toBeUndefined();
    expect(requests.every(url => url.startsWith('file:') || url.startsWith('data:'))).toBe(true);
  } finally {
    await page.close();
    await rm(directory, { recursive: true, force: true });
  }
});
