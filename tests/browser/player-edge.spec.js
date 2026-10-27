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

test('preserves external keyboard handlers and owns exactly one idempotently removable handler', async ({ page }) => {
  const result = await page.evaluate(() => {
    const host = document.querySelector('#preview');
    host.__tiquiPlayer?.destroy?.();
    let externalCalls = 0, playerAdds = 0, playerRemoves = 0;
    host.onkeydown = () => { externalCalls += 1 };
    const add = host.addEventListener.bind(host), remove = host.removeEventListener.bind(host);
    host.addEventListener = (type, listener, options) => { if (type === 'keydown') playerAdds += 1; add(type, listener, options) };
    host.removeEventListener = (type, listener, options) => { if (type === 'keydown') playerRemoves += 1; remove(type, listener, options) };
    const course = { id: 'x', title: 'X', icon: '', lessons: [] };
    const first = createPlayer(host, course, { preview: true });
    const second = createPlayer(host, course, { preview: true });
    const activeAfterReplacement = playerAdds - playerRemoves;
    first.destroy();
    second.destroy();
    second.destroy();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { externalCalls, propertyPreserved: typeof host.onkeydown === 'function', activeAfterReplacement, activeAfterDestroy: playerAdds - playerRemoves };
  });
  expect(result).toEqual({ externalCalls: 1, propertyPreserved: true, activeAfterReplacement: 1, activeAfterDestroy: 0 });
});

test('re-renders question media on retry and keeps decode failures non-blocking', async ({ page }) => {
  const calls = await page.evaluate(() => {
    const host = document.querySelector('#preview');
    const resolved = [];
    const media = { id: 'broken-video', kind: 'video', description: 'Описание видео' };
    createPlayer(host, { id: 'retry', title: 'Retry', icon: '', lessons: [{ id: 'l', title: 'L', icon: '', questions: [{ type: 'choice', text: 'Q', media, options: [{ text: 'Верно' }, { text: 'Неверно' }], answer: 0 }] }] }, {
      preview: true, resolveMedia: slot => { resolved.push(slot.id); return 'data:video/mp4;base64,broken' }
    });
    host.querySelector('.lesson-btn').click();
    return resolved;
  });
  expect(calls).toEqual(['broken-video']);
  const quiz = page.locator('#preview');
  await expect(quiz.locator('.question-media figcaption')).toHaveText('Описание видео');
  await expect(quiz.locator('.media-fallback')).toBeVisible();
  await quiz.locator('.opt').filter({ hasText: 'Неверно' }).click();
  await quiz.getByRole('button', { name: 'Проверить' }).click();
  await quiz.getByRole('button', { name: 'Дальше' }).click();
  await expect(quiz.locator('.retry')).toBeVisible();
  await expect(quiz.locator('.question-media figcaption')).toHaveText('Описание видео');
  await quiz.getByRole('button', { name: /^\d+ Верно$/ }).click();
  await expect(quiz.getByRole('button', { name: 'Проверить' })).toBeEnabled();
});

test('resolves only parser-produced slots and labels audio and video visibly', async ({ page }) => {
  const result = await page.evaluate(() => {
    const parsed = parseDocument(`# Медиа курс

ID: media-parsed

## Тема

Медиа: audio:intro-audio
Описание медиа: Вводное аудио

### Правда/ложь

Медиа: video:question-video
Описание медиа: Видео вопроса

Это вопрос

Ответ: правда`);
    const calls = []; window.__resolvedMediaCalls = calls;
    createPlayer(document.querySelector('#preview'), parsed.course, { preview: true, resolveMedia: slot => { calls.push({ id: slot.id, kind: slot.kind }); return `data:${slot.kind}/mp4;base64,broken` } });
    return { errors: parsed.errors, calls };
  });
  expect(result.errors).toEqual([]);
  const quiz = page.locator('#preview');
  await quiz.locator('.lesson-btn').click();
  await expect(quiz.locator('.media-intro figcaption')).toHaveText('Вводное аудио');
  await quiz.getByRole('button', { name: 'Перейти к вопросам' }).click();
  await expect(quiz.locator('.question-media figcaption')).toHaveText('Видео вопроса');
  expect(result.calls).toEqual([]);
  expect(await page.evaluate(() => window.__resolvedMediaCalls)).toEqual([{ id: 'intro-audio', kind: 'audio' }, { id: 'question-video', kind: 'video' }]);
});
