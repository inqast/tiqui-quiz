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

test('renders skippable lesson and question media without blocking answers', async ({ page }) => {
  await page.evaluate(() => {
    const host = document.querySelector('#preview');
    const media = (id, kind, description) => ({ id, kind, description });
    window.__player = createPlayer(host, {
      id: 'media-course', title: 'Медиа', icon: '🎓', description: '',
      lessons: [{ id: 'lesson', title: 'Тема', icon: '📘', media: media('intro', 'video', 'Вводное видео'), questions: [{ type: 'choice', text: 'Вопрос', media: media('question', 'image', '<img src=x onerror=alert(1)>'), options: [{ text: 'Да' }, { text: 'Нет' }], answer: 0 }] }]
    }, { preview: true, resolveMedia: slot => slot.id === 'intro' ? 'data:video/mp4;base64,AAAA' : 'data:image/png;base64,AAAA' });
  });
  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();
  await expect(quiz.locator('.media-intro video')).toHaveAttribute('preload', 'metadata');
  expect(await quiz.locator('.media-intro video').getAttribute('autoplay')).toBeNull();
  await expect(quiz.getByRole('button', { name: 'Перейти к вопросам' })).toBeVisible();
  await quiz.getByRole('button', { name: 'Перейти к вопросам' }).click();
  await expect(quiz.locator('.question-media img')).toHaveAttribute('alt', '<img src=x onerror=alert(1)>');
  await expect(quiz.locator('.question-media script')).toHaveCount(0);
  await expect(quiz.getByRole('button', { name: 'Проверить' })).toBeDisabled();
});

test('fails closed for unresolved media and destroy removes keyboard ownership', async ({ page }) => {
  const result = await page.evaluate(() => {
    const host = document.querySelector('#preview');
    const course = { id: 'x', title: 'X', icon: '', lessons: [{ id: 'l', title: 'L', icon: '', media: { id: 'missing', kind: 'audio', description: 'Аудио' }, questions: [{ type: 'tf', text: 'Q', answer: true }] }] };
    const player = createPlayer(host, course, { preview: true });
    host.querySelector('.lesson-btn').click();
    const fallback = host.querySelector('.media-fallback')?.textContent;
    player.destroy();
    return { fallback, handlerRemoved: host.onkeydown === null };
  });
  expect(result.fallback).toContain('Медиа недоступно');
  expect(result.handlerRemoved).toBe(true);
});
