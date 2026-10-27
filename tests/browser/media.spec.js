import { expect, test } from '@playwright/test';

const mediaCourse = `# Медиа курс

Описание: Проверка медиа
ID: media-course

## Тема с медиа

Иконка: 🎬
Медиа: image:intro-image
Описание медиа: Обложка темы

### Выбор
Медиа: audio:question-audio
Описание медиа: Аудио вопроса
Какой ответ верный?
- [x] Первый
- [ ] Второй
`;

const image = { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('image') };
const audio = { name: 'voice.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio') };

test.beforeEach(async ({ page }) => {
  await page.goto('/quiz.html');
});

test('shows project controls with template terminology and always exports a ZIP', async ({ page }) => {
  await expect(page.getByText('Из шаблона — в самостоятельный учебный квиз')).toBeVisible();
  for (const label of ['Импортировать шаблон', 'Скачать шаблон', 'Открыть проект', 'Сохранить проект', 'Скачать квиз для ученика']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('body')).not.toContainText('Markdown');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать квиз для ученика' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('название-квиза.zip');
});

test('attaches, previews, replaces and removes media through anchored slots', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('Обложка темы');
  await expect(page.locator('[data-slot-id="question-audio"]')).toContainText('Аудио вопроса');
  await expect(page.getByRole('button', { name: 'Скачать квиз для ученика' })).toBeDisabled();

  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.png');
  await expect(page.locator('#mediaTotal')).toContainText('5 Б');
  await page.locator('[data-slot-id="question-audio"] input[type=file]').setInputFiles(audio);
  await page.locator('#preview .lesson-btn').click();
  await expect(page.locator('#preview img[alt="Обложка темы"]')).toBeAttached();
  await page.getByRole('button', { name: 'Перейти к вопросам' }).click();
  await expect(page.locator('#preview audio[aria-label="Аудио вопроса"]')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Скачать квиз для ученика' })).toBeEnabled();

  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles({ ...image, name: 'replacement.webp', mimeType: 'image/webp' });
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.webp');
  await page.locator('[data-slot-id="intro-image"] button', { hasText: 'Удалить' }).click();
  await expect(page.locator('[data-slot-id="intro-image"]')).toHaveCount(0);
  await expect(page.locator('[data-owner-key="lesson:0"]')).toContainText('Добавить медиа');
  await expect(page.getByRole('button', { name: 'Скачать квиз для ученика' })).toBeEnabled();
});

test('adds a canonical slot only after description and valid local file are supplied', async ({ page }) => {
  const row = page.locator('[data-owner-key="lesson:0"]');
  await row.getByRole('button', { name: 'Добавить медиа' }).click();
  await page.locator('#mediaKind').selectOption('image');
  await page.locator('#mediaFile').setInputFiles(image);
  await page.getByRole('button', { name: 'Добавить файл' }).click();
  await expect(page.locator('#mediaDialogError')).toContainText('Добавьте описание');
  await expect(page.locator('#source')).not.toContainText('Медиа: image:');

  await page.locator('#mediaDescription').fill('Новая обложка');
  await page.getByRole('button', { name: 'Добавить файл' }).click();
  await expect(page.locator('#source')).toHaveValue(/Медиа: image:первая-тема-media/);
  await expect(page.locator('#source')).toHaveValue(/Описание медиа: Новая обложка/);
  await expect(page.locator('[data-slot-id="первая-тема-media"]')).toContainText('первая-тема-media.png');
});

test('keeps the last valid outline read-only while source is invalid and restores the same anchors', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  const slot = page.locator('[data-slot-id="intro-image"]');
  await expect(slot.locator('input[type=file]')).toBeEnabled();
  await page.locator('#source').fill(mediaCourse.replace('### Выбор', '### Неизвестно'));
  await expect(slot.locator('input[type=file]')).toBeDisabled();
  await expect(page.locator('#mediaPanel')).toContainText('Исправьте шаблон');

  await page.locator('#source').fill(mediaCourse);
  await expect(page.locator('[data-slot-id="intro-image"] input[type=file]')).toBeEnabled();
});

test('rejects unsupported files per slot without changing the template', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles({
    name: 'payload.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>')
  });
  await expect(page.locator('[data-slot-id="intro-image"] .media-error')).toContainText('не входят в список поддерживаемых');
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('Файл не выбран');
});

test('saves and transactionally reopens a project while a failed open preserves state', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await page.locator('[data-slot-id="question-audio"] input[type=file]').setInputFiles(audio);
  const savedPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить проект' }).click();
  const saved = await savedPromise;
  expect(saved.suggestedFilename()).toBe('media-course.tiqui');
  const path = test.info().outputPath('media-course.tiqui');
  await saved.saveAs(path);

  await page.locator('#source').fill('# Другой курс');
  await page.locator('#projectInput').setInputFiles(path);
  await expect(page.locator('#source')).toHaveValue(mediaCourse);
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.png');

  await page.locator('#projectInput').setInputFiles({ name: 'broken.tiqui', mimeType: 'application/zip', buffer: Buffer.from('not zip') });
  await expect(page.locator('#projectStatus')).toContainText('Не удалось открыть проект');
  await expect(page.locator('#source')).toHaveValue(mediaCourse);
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.png');
  await expect(page.locator('#preview')).toContainText('Медиа курс');
});

test('disposes the old registry when importing a template with the same slot IDs', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await page.evaluate(() => {
    window.__revokedMediaUrls = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = value => { window.__revokedMediaUrls++; revoke(value); };
  });
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await page.locator('#preview .lesson-btn').click();
  await expect(page.locator('#preview img[alt="Обложка темы"]')).toBeAttached();

  await page.locator('#fileInput').setInputFiles({ name: 'same.md', mimeType: 'text/markdown', buffer: Buffer.from(mediaCourse) });

  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('Файл не выбран');
  await expect(page.getByRole('button', { name: 'Скачать квиз для ученика' })).toBeDisabled();
  expect(await page.evaluate(() => window.__revokedMediaUrls)).toBeGreaterThan(0);
});

test('shows cancellable busy state and prevents double project actions', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await page.locator('[data-slot-id="question-audio"] input[type=file]').setInputFiles(audio);
  await page.evaluate(() => { crypto.subtle.digest = () => new Promise(() => {}); });
  await page.getByRole('button', { name: 'Сохранить проект' }).click();
  await expect(page.locator('#operationProgress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить проект' })).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить операцию' }).click();
  await expect(page.locator('#operationProgress')).toBeHidden();
});

test('invalidates stale media controls synchronously when the template changes', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  const stale = await page.locator('[data-slot-id="intro-image"] input[type=file]').elementHandle();
  const disabledImmediately = await page.evaluate(() => {
    const source = document.querySelector('#source');
    source.value = source.value.replace('## Тема с медиа', '## Переименованная тема');
    source.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('[data-slot-id="intro-image"] input[type=file]').disabled;
  });
  expect(disabledImmediately).toBe(true);
  await stale.setInputFiles(image);
  await expect(page.locator('#mediaTotal')).toHaveText('0 Б');
});

test('enforces exact media and project size boundaries through the UI', async ({ page }) => {
  await page.addInitScript(() => { window.__TIQUI_TEST_LIMITS = { image: 5, audio: 6, video: 7, total: 10 }; });
  await page.reload();
  await page.locator('#source').fill(mediaCourse);
  let input = page.locator('[data-slot-id="intro-image"] input[type=file]');
  await input.setInputFiles({ ...image, buffer: Buffer.alloc(5) });
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.png');
  await input.setInputFiles({ ...image, buffer: Buffer.alloc(6) });
  await expect(page.locator('[data-slot-id="intro-image"] .media-error')).toContainText('5 байт');

  await page.reload();
  await page.locator('#source').fill(mediaCourse);
  input = page.locator('[data-slot-id="question-audio"] input[type=file]');
  await input.setInputFiles({ ...audio, buffer: Buffer.alloc(6) });
  await expect(page.locator('[data-slot-id="question-audio"]')).toContainText('question-audio.mp3');
  await input.setInputFiles({ ...audio, buffer: Buffer.alloc(7) });
  await expect(page.locator('[data-slot-id="question-audio"] .media-error')).toContainText('6 байт');

  await page.reload();
  await page.locator('#source').fill(mediaCourse.replace('image:intro-image', 'video:intro-image'));
  input = page.locator('[data-slot-id="intro-image"] input[type=file]');
  await input.setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(7) });
  await expect(page.locator('[data-slot-id="intro-image"]')).toContainText('intro-image.mp4');
  await input.setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(8) });
  await expect(page.locator('[data-slot-id="intro-image"] .media-error')).toContainText('7 байт');

  await page.reload();
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles({ ...image, buffer: Buffer.alloc(5) });
  input = page.locator('[data-slot-id="question-audio"] input[type=file]');
  await input.setInputFiles({ ...audio, buffer: Buffer.alloc(5) });
  await expect(page.locator('#mediaTotal')).toHaveText('10 Б');
  await input.setInputFiles({ ...audio, buffer: Buffer.alloc(6) });
  await expect(page.locator('[data-slot-id="question-audio"] .media-error')).toContainText('10 байт');
});

test('asks before exporting a package above the confirmation threshold', async ({ page }) => {
  await page.addInitScript(() => { window.__TIQUI_CONFIRM_THRESHOLD = 4; });
  await page.reload();
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await page.locator('[data-slot-id="question-audio"] input[type=file]').setInputFiles(audio);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Скачать квиз для ученика' }).click();
  await expect(page.locator('#operationProgress')).toBeHidden();
  await expect(page.locator('#mediaTotal')).toHaveText('10 Б');
});

test('prunes orphan media when saving so the project reopens', async ({ page }) => {
  await page.locator('#source').fill(mediaCourse);
  await page.locator('[data-slot-id="intro-image"] input[type=file]').setInputFiles(image);
  await page.locator('#source').fill(mediaCourse.replace(/Медиа: image:intro-image\nОписание медиа: Обложка темы\n/, ''));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить проект' }).click();
  const saved = await downloadPromise;
  const path = test.info().outputPath('pruned.tiqui');
  await saved.saveAs(path);
  await page.locator('#projectInput').setInputFiles(path);
  await expect(page.locator('#projectStatus')).not.toContainText('Не удалось открыть проект');
  await expect(page.locator('#mediaTotal')).toHaveText('0 Б');
});
