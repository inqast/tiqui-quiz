import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const fixture = new URL('../fixtures/all-question-types.md', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.999999; });
  await page.goto('/quiz.html');
});

test('opens with a valid multi-topic starter', async ({ page }) => {
  await expect(page.locator('#messages')).toContainText('Документ корректен: 2 тем, 5 вопросов');
  await expect(page.locator('#preview .lesson-btn')).toHaveCount(2);
  await expect(page.locator('#exportHtml')).toBeEnabled();
});

test('updates validation and preview when course metadata is removed', async ({ page }) => {
  const source = page.locator('#source');
  const initial = await source.inputValue();

  await source.fill(initial.replace(/^# .*(?:\r?\n|$)/, ''));
  await expect(page.locator('#editStatus')).toContainText('ошиб');
  await expect(page.locator('#messages')).toContainText('Добавьте название курса');
  await expect(page.locator('#preview')).toBeEmpty();

  await source.fill(initial.replace('Описание: Короткое описание курса для ученика\n', ''));
  await expect(page.locator('#editStatus')).toHaveText('сохранено локально');
  await expect(page.locator('#preview')).not.toContainText('Короткое описание курса для ученика');
  await expect(page.locator('#preview .home-head .muted')).toHaveCount(0);
});

test('rejects removed intermediate lesson and question headings', async ({ page }) => {
  const source = page.locator('#source');
  const initial = await source.inputValue();

  await source.fill(initial.replace(/^\s*## Вторая тема\s*$/m, ''));
  await expect(page.locator('#messages')).toContainText('можно указывать только сразу после заголовка курса или темы');
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#exportHtml')).toBeDisabled();

  await source.fill(initial.replace(/^\s*### Правда или ложь\s*$/m, ''));
  await expect(page.locator('#messages')).toContainText('не удалось распознать строку внутри вопроса');
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#exportHtml')).toBeDisabled();
});

test('shows one helpful error when the first question type is removed', async ({ page }) => {
  const source = page.locator('#source');
  const initial = await source.inputValue();

  await source.fill(initial.replace(/^\s*### Выбор\s*$/m, ''));
  const errors = page.locator('#messages li');
  await expect(errors).toHaveCount(1);
  await expect(errors.first()).toContainText('перед содержимым вопроса укажите его тип');
  await expect(errors.first()).toContainText('### Выбор');
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#exportHtml')).toBeDisabled();
});

test('shows one useful error when the first lesson heading is removed', async ({ page }) => {
  const source = page.locator('#source');
  const initial = await source.inputValue();

  await source.fill(initial.replace(/^\s*## Первая тема\s*$/m, ''));
  const errors = page.locator('#messages li');
  await expect(errors).toHaveCount(1);
  await expect(errors.first()).toContainText('вопрос должен находиться внутри темы ##');
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#exportHtml')).toBeDisabled();
});

test('loads a Markdown file and blocks export for invalid content', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture);
  await expect(page.locator('#messages')).toContainText('Документ корректен: 1 тем, 5 вопросов');
  await expect(page.locator('#preview')).toContainText('Демонстрационный тест');

  await page.locator('#source').fill('# Только название');
  await expect(page.locator('#messages')).toContainText('Добавьте хотя бы одну тему');
  await expect(page.locator('#exportHtml')).toBeDisabled();
});

test('shows option feedback only after checking the answer', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles(fixture);
  await page.locator('#preview .lesson-btn').click();
  await page.getByRole('button', { name: /Бета/ }).click();

  await expect(page.locator('#preview')).not.toContainText('Бета нужна для проверки ошибочного ответа.');
  await page.locator('#preview .big-btn', { hasText: 'Проверить' }).click();
  await expect(page.locator('#preview')).toContainText('Бета нужна для проверки ошибочного ответа.');
});

test('exports a self-contained quiz that opens independently', async ({ page }, testInfo) => {
  await page.locator('#fileInput').setInputFiles(fixture);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportHtml').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('демонстрационный-тест.html');
  const filePath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(filePath);
  await page.goto(pathToFileURL(filePath).href);
  await expect(page.getByRole('heading', { name: /Демонстрационный тест/ })).toBeVisible();
  await expect(page.locator('.lesson-btn')).toHaveCount(1);
});
