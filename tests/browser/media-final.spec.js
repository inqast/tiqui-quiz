import { test, expect } from '@playwright/test';

const question = '### Выбор\nSame question?\n- [x] Yes\n- [ ] No\n';
const source = `# Course\nОписание: About\n\n## Lesson\n\n${question}\n${question}`;
const file = { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('first') };

test.beforeEach(async ({ page }) => { await page.goto('/quiz.html'); });

test('allocates unused canonical IDs for identical questions and preexisting manual slots atomically', async ({ page }) => {
  const input = source.replace('## Lesson', '## Lesson\nМедиа: image:same-question-media\nОписание медиа: Manual');
  await page.locator('#source').fill(input);
  await page.locator('[data-slot-id="same-question-media"] input').setInputFiles(file);
  for (let i = 0; i < 2; i++) {
    await page.locator(`[data-owner-key="question:0:${i}"]`).getByRole('button', { name: 'Добавить медиа' }).click();
    await page.locator('#mediaDescription').fill(`Question ${i}`);
    await page.locator('#mediaFile').setInputFiles({ ...file, buffer: Buffer.from(`new-${i}`) });
    await page.locator('#confirmMedia').click();
  }
  await expect(page.locator('#messages')).toContainText('Документ корректен');
  await expect(page.locator('[data-slot-id="same-question-media"]')).toContainText('same-question-media.png');
  await expect(page.locator('[data-slot-id="same-question-media-2"]')).toContainText('same-question-media-2.png');
  await expect(page.locator('[data-slot-id="same-question-media-3"]')).toContainText('same-question-media-3.png');
  await page.evaluate(() => { window.__TIQUI_DOWNLOAD = blob => { window.saved = blob; }; });
  await page.locator('#saveProject').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.saved))).toBe(true);
  const content = await page.evaluate(async () => new TextDecoder().decode(fflate.unzipSync(new Uint8Array(await window.saved.arrayBuffer()))['media/same-question-media.png']));
  expect(content).toBe('first');
});

test('pending open locks all source and media mutations and ignores a programmatic intervening edit', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TIQUI_PROJECT_PACKAGE = { openProject: () => new Promise(resolve => { window.finishOpen = resolve; }) };
  });
  await page.reload();
  await page.locator('#source').fill(source.replace('## Lesson', '## Lesson\nМедиа: image:intro\nОписание медиа: Manual'));
  await page.locator('[data-slot-id="intro"] input').setInputFiles(file);
  await page.locator('#projectInput').setInputFiles({ name: 'next.tiqui', mimeType: 'application/zip', buffer: Buffer.from('pending') });
  await expect(page.locator('#operationProgress')).toBeVisible();
  await expect(page.locator('#source')).toBeDisabled();
  await expect(page.locator('#clearEditor')).toBeDisabled();
  for (const control of await page.locator('#mediaOutline button, #mediaOutline input').all()) await expect(control).toBeDisabled();
  await page.evaluate(() => {
    const editor = document.querySelector('#source');
    editor.value += '\nОписание: New edit';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.finishOpen({ ok: true, value: { source: '# OLD', assets: [] } });
  });
  await expect(page.locator('#source')).toHaveValue(/New edit/);
  await expect(page.locator('#operationProgress')).toBeHidden();
});

test('late template import cannot overwrite a newer edit or canceled newer import', async ({ page }) => {
  await page.evaluate(() => {
    window.reads = [];
    File.prototype.text = function () { return new Promise(resolve => window.reads.push(resolve)); };
  });
  await page.locator('#fileInput').setInputFiles({ name: 'old.md', mimeType: 'text/markdown', buffer: Buffer.from('old') });
  await page.evaluate(() => {
    const editor = document.querySelector('#source'); editor.value = '# New edit'; editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.reads[0]('# OLD');
  });
  await expect(page.locator('#source')).toHaveValue('# New edit');
  await expect(page.locator('#operationProgress')).toBeHidden();
  await page.locator('#fileInput').setInputFiles({ name: 'older.md', mimeType: 'text/markdown', buffer: Buffer.from('old') });
  await expect.poll(() => page.evaluate(() => window.reads.length)).toBe(2);
  await page.locator('#cancelOperation').click();
  await page.locator('#fileInput').setInputFiles({ name: 'newer.md', mimeType: 'text/markdown', buffer: Buffer.from('new') });
  await expect.poll(() => page.evaluate(() => window.reads.length)).toBe(3);
  await page.evaluate(() => window.reads[1]('# OLD AGAIN'));
  await expect(page.locator('#operationProgress')).toBeVisible();
  await page.evaluate(() => window.reads[2]('# Newest'));
  await expect(page.locator('#source')).toHaveValue('# Newest');
});

test('template filename keeps exactly one md extension', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles({ name: 'lesson.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await expect(page.locator('#filename')).toHaveText('lesson.md');
});

test('unresolved media keeps a visible description caption', async ({ page }) => {
  await page.locator('#source').fill(source.replace('## Lesson', '## Lesson\nМедиа: audio:missing\nОписание медиа: Important description'));
  await expect(page.locator('[data-slot-id="missing"]')).toBeVisible();
  await page.locator('#preview .lesson-btn').click();
  await expect(page.locator('#preview .media-fallback')).toBeVisible();
  await expect(page.locator('#preview figcaption')).toHaveText('Important description');
});

test('pending student export cannot publish after an intervening source edit', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TIQUI_DOWNLOAD = () => { window.downloadCount = (window.downloadCount || 0) + 1; };
    window.__TIQUI_PROJECT_PACKAGE = { exportStudentCourse: payload => {
      window.exportedTitle = payload.course.title;
      return new Promise(resolve => { window.finishExport = resolve; });
    } };
  });
  await page.reload();
  await page.locator('#source').fill(source);
  await expect(page.locator('#exportHtml')).toBeEnabled();
  await page.locator('#exportHtml').click();
  await expect.poll(() => page.evaluate(() => window.exportedTitle)).toBe('Course');
  await expect(page.locator('#source')).toBeDisabled();
  await expect(page.locator('#clearEditor')).toBeDisabled();
  await page.evaluate(() => {
    const editor = document.querySelector('#source');
    editor.value = '# Changed during export'; editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.finishExport({ ok: true, value: new Blob(['old export']) });
  });
  await expect(page.locator('#operationProgress')).toBeHidden();
  expect(await page.evaluate(() => window.downloadCount || 0)).toBe(0);
  await expect(page.locator('#source')).toHaveValue('# Changed during export');
});

test('real ZIP lesson corruption preserves the active template and attached media', async ({ page }) => {
  const original = source.replace('## Lesson', '## Lesson\nМедиа: image:intro\nОписание медиа: Attached');
  await page.locator('#source').fill(original);
  await page.locator('[data-slot-id="intro"] input').setInputFiles(file);
  await page.evaluate(() => { window.__TIQUI_DOWNLOAD = blob => { window.saved = blob; }; });
  await page.locator('#saveProject').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.saved))).toBe(true);
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.saved.arrayBuffer()))));
  const offset = bytes.indexOf(Buffer.from('# Course'));
  expect(offset).toBeGreaterThan(0); bytes[offset + 2] ^= 1;
  await page.locator('#projectInput').setInputFiles({ name: 'corrupt.tiqui', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#projectStatus')).toContainText('Не удалось открыть проект');
  await expect(page.locator('#source')).toHaveValue(original);
  await expect(page.locator('[data-slot-id="intro"]')).toContainText('intro.png');
});
