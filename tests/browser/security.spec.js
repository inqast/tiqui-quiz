import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const payload = '</script><script>window.__tiquiXss=true</script><img src=x onerror="window.__tiquiXss=true">';

const maliciousCourse = `# ${payload}

Описание: ${payload}
ID: security-regression

## ${payload}

### Выбор

${payload}

- [x] ${payload}
  Подсказка: ${payload}
- [ ] Безопасный вариант
  Подсказка: ${payload}

Объяснение: ${payload}
`;

test.beforeEach(async ({ page }) => {
  await page.goto('/quiz.html');
});

test('keeps hostile Markdown inert in validation and preview', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));

  await page.locator('#source').fill(maliciousCourse);
  await expect(page.locator('#messages')).toContainText('Документ корректен');
  await expect(page.locator('#preview img')).toHaveCount(0);
  await expect(page.locator('#preview script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tiquiXss)).toBeUndefined();
  expect(requests.filter(url => url !== 'http://127.0.0.1:4173/quiz.html')).toEqual([]);
});

test('blocks stale export immediately while edited Markdown is revalidated', async ({ page }) => {
  const disabledImmediately = await page.evaluate(source => {
    const editor = document.querySelector('#source');
    editor.value = source;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('#exportHtml').disabled;
  }, maliciousCourse);

  expect(disabledImmediately).toBe(true);
  await expect(page.locator('#exportHtml')).toBeEnabled();
});

test('keeps hostile Markdown inert in an exported standalone quiz', async ({ page }, testInfo) => {
  await page.locator('#source').fill(maliciousCourse);
  await expect(page.locator('#exportHtml')).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportHtml').click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath('security-regression.zip');
  await download.saveAs(zipPath);
  const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
  const filePath = testInfo.outputPath('index.html');
  await writeFile(filePath, entries['index.html']);

  await page.goto(pathToFileURL(filePath).href);
  await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tiquiXss)).toBeUndefined();
  await expect(page.locator('.home-head h1')).toContainText(payload);
});

test('escapes hostile text in parser error messages', async ({ page }) => {
  await page.locator('#source').fill(`# Курс

## Тема

### ${payload}`);

  await expect(page.locator('#messages')).toContainText('неизвестный тип вопроса');
  await expect(page.locator('#messages img')).toHaveCount(0);
  await expect(page.locator('#messages script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tiquiXss)).toBeUndefined();
});


test('rejects hostile project archive paths transactionally without rendering descriptions', async ({ page }) => {
  const safeCourse = `# Безопасный курс

Описание: Исходное состояние
ID: safe-state

## Тема

Иконка: ✅

### Выбор
Вопрос?
- [x] Да
- [ ] Нет
`;
  await page.locator('#source').fill(safeCourse);
  const manifest = JSON.stringify({
    formatVersion: 1,
    media: [{
      slotId: 'intro',
      kind: 'image',
      filename: '../escape.png',
      mimeType: 'image/png',
      size: 3,
      sha256: '0'.repeat(64)
    }]
  });
  const archive = zipSync({
    'project.json': new TextEncoder().encode(manifest),
    'lesson.md': new TextEncoder().encode(`# ${payload}`),
    'media/../escape.png': new Uint8Array([1, 2, 3])
  });

  await page.locator('#projectInput').setInputFiles({
    name: 'hostile.tiqui',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive)
  });

  await expect(page.locator('#projectStatus')).toContainText('Не удалось открыть проект');
  await expect(page.locator('#source')).toHaveValue(safeCourse);
  await expect(page.locator('#preview')).toContainText('Безопасный курс');
  await expect(page.locator('#preview script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tiquiXss)).toBeUndefined();
});
