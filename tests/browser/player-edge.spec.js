import { expect, test } from '@playwright/test';

const inputQuiz = answer => `# Проверка ввода

ID: input-boundaries

## Тема

### Ввод

Введите ответ:

Ответы: ${answer}
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.999999; });
  await page.goto('/quiz.html');
});

async function setSource(page, source) {
  await page.locator('#source').fill(source);
  await expect(page.locator('#messages')).toContainText('Документ корректен: 1 тем, 1 вопросов');
}

test('accepts one typo in an answer longer than four characters', async ({ page }) => {
  await setSource(page, inputQuiz('демонстрация'));
  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();
  await quiz.locator('.tinput').fill('демонстраци');
  await quiz.getByRole('button', { name: 'Проверить' }).click();

  await expect(quiz).toContainText('Отлично!');
  await expect(quiz).toContainText('Пишется так: демонстрация');
});

test('requires an exact match for answers of four characters or fewer', async ({ page }) => {
  await setSource(page, inputQuiz('тест'));
  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();
  await quiz.locator('.tinput').fill('тес');
  await quiz.getByRole('button', { name: 'Проверить' }).click();

  await expect(quiz).toContainText('Почти!');
  await expect(quiz).toContainText('Правильно: тест');
});

test('renders HTML-looking question content as inert text', async ({ page }) => {
  const payload = '<img src=x onerror="window.__tiquiXss=true"> 🚀';
  await setSource(page, inputQuiz('ответ').replace('Введите ответ:', payload));

  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();
  await expect(quiz.locator('.qtext')).toHaveText(payload);
  await expect(quiz.locator('.qtext img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tiquiXss)).toBeUndefined();
});
