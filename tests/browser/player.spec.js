import { expect, test } from '@playwright/test';

const fixture = new URL('../fixtures/all-question-types.md', import.meta.url).pathname;

test('completes all five question types', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.999999; });
  await page.goto('/quiz.html');
  await page.locator('#fileInput').setInputFiles(fixture);
  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();

  await page.getByRole('button', { name: /Альфа/ }).click();
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();

  await page.getByRole('button', { name: /Правда/ }).click();
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();

  await quiz.locator('.tinput').fill('демонстрация');
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();

  for (const name of ['Первый', 'Второй', 'Третий']) {
    await quiz.locator('.bank').getByRole('button', { name }).click();
  }
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();

  await quiz.locator('.mcol').first().getByRole('button', { name: 'Один' }).click();
  await quiz.locator('.mcol').last().getByRole('button', { name: '1', exact: true }).click();
  await quiz.locator('.mcol').first().getByRole('button', { name: 'Два' }).click();
  await quiz.locator('.mcol').last().getByRole('button', { name: '2', exact: true }).click();
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();

  await expect(quiz.getByRole('heading', { name: 'Тема пройдена!' })).toBeVisible();
  await expect(quiz).toContainText('5');
  await expect(quiz).toContainText('с первого раза');
});
