import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

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
