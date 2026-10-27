import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseDocument } from '../../src/parser.js';
import { loadStarter } from '../helpers/load-starter.js';

const fixtureUrl = new URL('../fixtures/all-question-types.md', import.meta.url);
const exampleUrl = new URL('../../lesson-example.md', import.meta.url);
const questionDocument = (type, body, question = 'Тестовый вопрос?') => `# Курс

## Тема

### ${type}

${question}

${body}
`;

test('parses every supported question type', async () => {
  const source = await readFile(fixtureUrl, 'utf8');
  const result = parseDocument(source);

  assert.deepEqual(Array.from(result.errors), []);
  assert.deepEqual(
    Array.from(result.course.lessons[0].questions, question => question.type),
    ['choice', 'tf', 'input', 'order', 'match'],
  );
});

test('keeps option-specific feedback and accepted input answers', async () => {
  const source = await readFile(fixtureUrl, 'utf8');
  const { course } = parseDocument(source);
  const [choice, , input] = course.lessons[0].questions;

  assert.equal(choice.options[1].feedback, 'Бета нужна для проверки ошибочного ответа.');
  assert.deepEqual(Array.from(input.answers), ['пример', 'демонстрация']);
});

test('rejects a choice without exactly one correct option', async () => {
  const result = parseDocument(`# Курс

## Тема

### Выбор

Вопрос?

- [ ] Один
- [ ] Два
`);

  assert.match(result.errors.join('\n'), /ровно один правильный вариант/);
});

test('reports the source line for an unknown question type', async () => {
  const result = parseDocument(`# Курс

## Тема

### Неизвестный тип

Вопрос?
`);

  assert.equal(result.errors[0], 'Строка 5: неизвестный тип вопроса «неизвестный тип»');
});

test('accepts CRLF documents and boolean aliases', async () => {
  const result = parseDocument('# Курс\r\n\r\n## Тема\r\n\r\n### Правда/ложь\r\n\r\nУтверждение.\r\n\r\nОтвет: да\r\n');

  assert.deepEqual(Array.from(result.errors), []);
  assert.equal(result.course.lessons[0].questions[0].answer, true);
});

test('preserves Russian letters with diacritics in generated IDs', async () => {
  const result = parseDocument(`# Демонстрационный квиз

## Новый материал

### Ввод

Введите ответ:

Ответы: ответ
`);

  assert.equal(result.course.id, 'демонстрационный-квиз');
  assert.equal(result.course.lessons[0].id, 'новый-материал-1');
});

test('uses default icons when icon fields are empty', () => {
  const result = parseDocument(`# Курс

Иконка:

## Тема

Иконка:   

### Ввод

Введите ответ:

Ответы: ответ
`);

  assert.deepEqual(Array.from(result.errors), []);
  assert.equal(result.course.icon, '🧩');
  assert.equal(result.course.lessons[0].icon, '📘');
});

test('reports a missing course title without throwing on course metadata', () => {
  const parsed = parseDocument(`Иконка: 🚀
Описание: Курс без заголовка

## Тема`);

  assert.equal(parsed.course, null);
  assert.ok(parsed.errors.includes('Добавьте название курса: # Название'));
});

test('keeps an omitted course description empty', () => {
  const parsed = parseDocument(`# Курс

## Тема

### Правда или ложь
Утверждение
Ответ: правда`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.course.description, '');
});

test('rejects course or lesson metadata inside a question', async t => {
  for (const field of ['Иконка: 🌟', 'Описание: описание', 'ID: misplaced']) {
    await t.test(field.split(':')[0], () => {
      const parsed = parseDocument(`# Курс

## Тема

### Правда или ложь
Утверждение
${field}
Ответ: правда`);

      assert.ok(parsed.errors.some(error => error.includes('можно указывать только сразу после заголовка курса или темы')));
    });
  }
});

test('rejects a later lesson whose heading was removed', () => {
  const parsed = parseDocument(`# Курс

## Первая тема
Иконка: 1️⃣

### Правда или ложь
Первое утверждение
Ответ: правда

Иконка: 2️⃣

### Правда или ложь
Второе утверждение
Ответ: ложь`);

  assert.ok(parsed.errors.some(error => error.includes('можно указывать только сразу после заголовка курса или темы')));
});

test('rejects content left after an intermediate question heading was removed', () => {
  const parsed = parseDocument(`# Курс

## Тема

### Правда или ложь
Первое утверждение
Ответ: правда

Второе утверждение
Ответ: ложь`);

  assert.ok(parsed.errors.some(error => error.includes('не удалось распознать строку внутри вопроса')));
  assert.ok(parsed.errors.some(error => error.includes('ответ указан повторно')));
});

test('reports one friendly error when the first question type is missing', () => {
  const parsed = parseDocument(`# Курс

## Тема

Текст вопроса
- [x] Верно
- [ ] Неверно
Объяснение: пояснение

### Правда или ложь
Следующий вопрос
Ответ: правда`);

  const missingTypeErrors = parsed.errors.filter(error => error.includes('перед содержимым вопроса укажите его тип'));
  assert.equal(missingTypeErrors.length, 1);
  assert.ok(missingTypeErrors[0].includes('### Выбор'));
  assert.ok(!parsed.errors.some(error => error.includes('не удалось распознать строку')));
});

test('reports one useful error when the first lesson heading is missing', () => {
  const parsed = parseDocument(`# Курс

### Выбор
Первый вопрос
- [x] Верно
- [ ] Неверно

### Правда или ложь
Второй вопрос
Ответ: правда

## Следующая тема

### Правда или ложь
Третий вопрос
Ответ: правда`);

  const missingLessonErrors = parsed.errors.filter(error => error.includes('вопрос должен находиться внутри темы ##'));
  assert.equal(missingLessonErrors.length, 1);
  assert.ok(!parsed.errors.some(error => error.includes('не удалось распознать строку')));
  assert.equal(parsed.course.lessons.length, 1);
  assert.equal(parsed.course.lessons[0].title, 'Следующая тема');
});

test('the built-in starter remains valid and demonstrates all types', async () => {
  const source = await loadStarter();
  const result = parseDocument(source);

  assert.deepEqual(Array.from(result.errors), []);
  assert.equal(result.course.lessons.length, 2);
  assert.deepEqual(
    Array.from(result.course.lessons.flatMap(lesson => lesson.questions), question => question.type),
    ['choice', 'tf', 'input', 'order', 'match'],
  );
});

test('the distributed lesson example remains valid', async () => {
  const source = await readFile(exampleUrl, 'utf8');
  const result = parseDocument(source);

  assert.deepEqual(Array.from(result.errors), []);
});

test('validates choice edge cases', async t => {
  const cases = [
    {
      name: 'rejects multiple correct options',
      body: '- [x] Один\n- [X] Два',
      error: /ровно один правильный вариант/,
    },
    {
      name: 'rejects a single option',
      body: '- [x] Один',
      error: /хотя бы два варианта/,
    },
    {
      name: 'rejects an empty option',
      body: '- [x]\n- [ ] Два',
      error: /вариант ответа не может быть пустым/,
    },
    {
      name: 'rejects duplicate options ignoring case and spaces',
      body: '- [x] Один вариант\n- [ ]  один   ВАРИАНТ',
      error: /варианты ответа не должны повторяться/,
    },
    {
      name: 'rejects feedback before the first option',
      body: 'Подсказка: Рано\n- [x] Один\n- [ ] Два',
      error: /подсказка должна следовать после варианта ответа/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const result = parseDocument(questionDocument('Выбор', item.body));
      assert.match(result.errors.join('\n'), item.error);
    });
  }

  await t.test('accepts uppercase X and attaches feedback to its option', () => {
    const result = parseDocument(questionDocument('Выбор', '- [X] Один\n  Подсказка: Первая\n- [ ] Два'));
    assert.deepEqual(Array.from(result.errors), []);
    assert.equal(result.course.lessons[0].questions[0].options[0].feedback, 'Первая');
  });
});

test('validates true-or-false edge cases', async t => {

  for (const [value, expected] of [['ПРАВДА', true], ['да', true], ['TRUE', true], ['ЛОЖЬ', false], ['нет', false], ['FALSE', false]]) {
    await t.test(`accepts ${value}`, () => {
      const result = parseDocument(questionDocument('Правда или ложь', `Ответ: ${value}`));
      assert.deepEqual(Array.from(result.errors), []);
      assert.equal(result.course.lessons[0].questions[0].answer, expected);
    });
  }

  for (const [name, body, error] of [
    ['a missing answer', '', /укажите Ответ/],
    ['an empty answer', 'Ответ:', /ответ должен быть/],
    ['an unknown answer', 'Ответ: возможно', /ответ должен быть/],
    ['a repeated answer', 'Ответ: правда\nОтвет: ложь', /ответ указан повторно/],
  ]) {
    await t.test(`rejects ${name}`, () => {
      const result = parseDocument(questionDocument('Правда или ложь', body));
      assert.match(result.errors.join('\n'), error);
    });
  }
});

test('validates input edge cases', async t => {

  await t.test('rejects a missing answer list', () => {
    const result = parseDocument(questionDocument('Ввод', 'Подсказка: Без ответа'));
    assert.match(result.errors.join('\n'), /укажите Ответы/);
  });

  await t.test('rejects an empty answer list', () => {
    const result = parseDocument(questionDocument('Ввод', 'Ответы: | |'));
    assert.match(result.errors.join('\n'), /укажите Ответы/);
  });

  await t.test('trims answers, ignores empty parts and removes normalized duplicates', () => {
    const result = parseDocument(questionDocument('Ввод', 'Ответы:  Первый ответ | | первый   ОТВЕТ | Второй | второй'));
    assert.deepEqual(Array.from(result.errors), []);
    assert.deepEqual(Array.from(result.course.lessons[0].questions[0].answers), ['Первый ответ', 'Второй']);
  });
});

test('validates order edge cases', async t => {

  for (const [name, body, error] of [
    ['no items', 'Объяснение: Пусто', /хотя бы два пункта/],
    ['one item', '1. Один', /хотя бы два пункта/],
    ['an empty item', '1. Один\n2.', /элемент порядка не может быть пустым/],
    ['duplicate items', '1. Один элемент\n2. один   ЭЛЕМЕНТ', /элементы порядка не должны повторяться/],
  ]) {
    await t.test(`rejects ${name}`, () => {
      const result = parseDocument(questionDocument('Порядок', body));
      assert.match(result.errors.join('\n'), error);
    });
  }

  await t.test('uses line order and permits non-sequential numbering', () => {
    const result = parseDocument(questionDocument('Порядок', '1. Первый\n3. Второй\n9. Третий'));
    assert.deepEqual(Array.from(result.errors), []);
    assert.deepEqual(Array.from(result.course.lessons[0].questions[0].items), ['Первый', 'Второй', 'Третий']);
  });
});

test('validates matching-pair edge cases', async t => {

  for (const [name, body, error] of [
    ['no pairs', 'Объяснение: Пусто', /хотя бы две пары/],
    ['one pair', '- Один => 1', /хотя бы две пары/],
    ['a missing separator', '- Один 1\n- Два => 2', /ровно один разделитель/],
    ['multiple separators', '- Один => 1 => I\n- Два => 2', /ровно один разделитель/],
    ['an empty left side', '- => 1\n- Два => 2', /обе части пары должны быть заполнены/],
    ['an empty right side', '- Один =>\n- Два => 2', /обе части пары должны быть заполнены/],
    ['duplicate left sides', '- Один => 1\n- один => 2', /левые части пар не должны повторяться/],
    ['duplicate right sides', '- Один => Значение\n- Два => значение', /правые части пар не должны повторяться/],
  ]) {
    await t.test(`rejects ${name}`, () => {
      const result = parseDocument(questionDocument('Пары', body));
      assert.match(result.errors.join('\n'), error);
    });
  }

  await t.test('trims whitespace around the separator', () => {
    const result = parseDocument(questionDocument('Пары', '- Один   =>   1\n- Два=>2'));
    assert.deepEqual(Array.from(result.errors), []);
    const pairs = result.course.lessons[0].questions[0].pairs;
    assert.equal(pairs[0].left, 'Один');
    assert.equal(pairs[0].right, '1');
  });
});

test('validates common question boundaries and preserves unsafe-looking text as data', async t => {

  await t.test('rejects a question without text', () => {
    const result = parseDocument(questionDocument('Ввод', 'Ответы: ответ', ''));
    assert.match(result.errors.join('\n'), /нет текста вопроса/);
  });

  await t.test('rejects a question outside a topic', () => {
    const result = parseDocument('# Курс\n\n### Ввод\n\nВопрос?\n\nОтветы: ответ');
    assert.match(result.errors.join('\n'), /вопрос должен находиться внутри темы/);
  });

  await t.test('preserves HTML and emoji without interpreting them', () => {
    const text = '<img src=x onerror=alert(1)> 🚀';
    const result = parseDocument(questionDocument('Ввод', 'Ответы: ответ', text));
    assert.deepEqual(Array.from(result.errors), []);
    assert.equal(result.course.lessons[0].questions[0].text, text);
  });
});

test('parses lesson and question media slots with stable normalized IDs and heading anchors', () => {
  const source = `# Курс

## Тема
Иконка: 🌌
Описание: Описание темы
ID: ignored-by-current-lesson-schema
Медиа: video:  Вводное Видео
Описание медиа: Орбиты планет

### Выбор
Описание медиа: Фотография Меркурия
Медиа: image:Меркурий ФОТО
Что изображено?
- [x] Меркурий
- [ ] Венера`;
  const parsed = parseDocument(source);

  assert.deepEqual(Array.from(parsed.errors), []);
  assert.equal(parsed.course.lessons[0].line, 2);
  assert.deepEqual(parsed.course.lessons[0].media, {
    id: 'вводное-видео',
    kind: 'video',
    description: 'Орбиты планет'
  });
  assert.equal(parsed.course.lessons[0].questions[0].line, 9);
  assert.deepEqual(parsed.course.lessons[0].questions[0].media, {
    id: 'меркурий-фото',
    kind: 'image',
    description: 'Фотография Меркурия'
  });
});

test('keeps media-free course objects free of media properties', () => {
  const parsed = parseDocument(questionDocument('Ввод', 'Ответы: ответ'));

  assert.deepEqual(Array.from(parsed.errors), []);
  assert.equal(Object.hasOwn(parsed.course.lessons[0], 'media'), false);
  assert.equal(Object.hasOwn(parsed.course.lessons[0].questions[0], 'media'), false);
});

test('rejects invalid media metadata', async t => {
  const cases = [
    ['unknown kind', 'Медиа: document:slot-id\nОписание медиа: Документ', /вид медиа.*image.*video.*audio/i],
    ['empty media', 'Медиа:\nОписание медиа: Пустой слот', /поле «Медиа» не может быть пустым/i],
    ['empty description', 'Медиа: image:slot-id\nОписание медиа:', /поле «Описание медиа» не может быть пустым/i],
    ['orphan description', 'Описание медиа: Без слота', /Описание медиа.*без поля «Медиа»/i],
    ['repeated media', 'Медиа: image:first\nМедиа: image:second\nОписание медиа: Два слота', /поле «Медиа» указано повторно/i],
    ['repeated description', 'Медиа: image:slot-id\nОписание медиа: Первая\nОписание медиа: Вторая', /поле «Описание медиа» указано повторно/i],
    ['missing description', 'Медиа: audio:slot-id', /для медиа.*укажите «Описание медиа»/i]
  ];

  for (const [name, metadata, expectedError] of cases) {
    await t.test(name, () => {
      const parsed = parseDocument(`# Курс

## Тема
${metadata}

### Ввод
Вопрос?
Ответы: ответ`);
      assert.match(parsed.errors.join('\n'), expectedError);
      assert.equal(Object.hasOwn(parsed.course.lessons[0], 'media'), false);
    });
  }
});

test('rejects duplicate canonical media IDs across owners', () => {
  const parsed = parseDocument(`# Курс

## Тема
Медиа: video:Общее Медиа
Описание медиа: Введение

### Ввод
Медиа: audio:общее-медиа
Описание медиа: Аудио
Вопрос?
Ответы: ответ`);

  assert.match(parsed.errors.join('\n'), /идентификатор медиа «общее-медиа» уже используется/i);
  assert.deepEqual(parsed.course.lessons[0].media, {
    id: 'общее-медиа',
    kind: 'video',
    description: 'Введение'
  });
  assert.equal(Object.hasOwn(parsed.course.lessons[0].questions[0], 'media'), false);
});

test('accepts lesson media after existing metadata fields', () => {
  const parsed = parseDocument(`# Курс

## Тема
Иконка: 🌌
Описание: Текст темы
ID: stable-topic
Медиа: audio:intro
Описание медиа: Вступление

### Ввод
Вопрос?
Ответы: ответ`);

  assert.deepEqual(Array.from(parsed.errors), []);
  assert.deepEqual(parsed.course.lessons[0].media, {
    id: 'intro',
    kind: 'audio',
    description: 'Вступление'
  });
});

test('rejects question media fields after question text', () => {
  const parsed = parseDocument(`# Курс

## Тема

### Ввод
Вопрос?
Медиа: image:late-image
Описание медиа: Позднее изображение
Ответы: ответ`);

  assert.match(parsed.errors.join('\n'), /медиа вопроса.*сразу после заголовка вопроса/i);
  assert.equal(Object.hasOwn(parsed.course.lessons[0].questions[0], 'media'), false);
});
