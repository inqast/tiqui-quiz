import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadParser, loadStarter } from '../helpers/load-parser.js';

const fixtureUrl = new URL('../fixtures/all-question-types.md', import.meta.url);
const exampleUrl = new URL('../../lesson-example.md', import.meta.url);
const questionDocument = (type, body, question = 'Тестовый вопрос?') => `# Курс

## Тема

### ${type}

${question}

${body}
`;

test('parses every supported question type', async () => {
  const parseDocument = await loadParser();
  const source = await readFile(fixtureUrl, 'utf8');
  const result = parseDocument(source);

  assert.deepEqual(Array.from(result.errors), []);
  assert.deepEqual(
    Array.from(result.course.lessons[0].questions, question => question.type),
    ['choice', 'tf', 'input', 'order', 'match'],
  );
});

test('keeps option-specific feedback and accepted input answers', async () => {
  const parseDocument = await loadParser();
  const source = await readFile(fixtureUrl, 'utf8');
  const { course } = parseDocument(source);
  const [choice, , input] = course.lessons[0].questions;

  assert.equal(choice.options[1].feedback, 'Бета нужна для проверки ошибочного ответа.');
  assert.deepEqual(Array.from(input.answers), ['пример', 'демонстрация']);
});

test('rejects a choice without exactly one correct option', async () => {
  const parseDocument = await loadParser();
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
  const parseDocument = await loadParser();
  const result = parseDocument(`# Курс

## Тема

### Неизвестный тип

Вопрос?
`);

  assert.equal(result.errors[0], 'Строка 5: неизвестный тип вопроса «неизвестный тип»');
});

test('accepts CRLF documents and boolean aliases', async () => {
  const parseDocument = await loadParser();
  const result = parseDocument('# Курс\r\n\r\n## Тема\r\n\r\n### Правда/ложь\r\n\r\nУтверждение.\r\n\r\nОтвет: да\r\n');

  assert.deepEqual(Array.from(result.errors), []);
  assert.equal(result.course.lessons[0].questions[0].answer, true);
});

test('preserves Russian letters with diacritics in generated IDs', async () => {
  const parseDocument = await loadParser();
  const result = parseDocument(`# Демонстрационный квиз

## Новый материал

### Ввод

Введите ответ:

Ответы: ответ
`);

  assert.equal(result.course.id, 'демонстрационный-квиз');
  assert.equal(result.course.lessons[0].id, 'новый-материал-1');
});

test('the built-in starter remains valid and demonstrates all types', async () => {
  const parseDocument = await loadParser();
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
  const parseDocument = await loadParser();
  const source = await readFile(exampleUrl, 'utf8');
  const result = parseDocument(source);

  assert.deepEqual(Array.from(result.errors), []);
});

test('validates choice edge cases', async t => {
  const parseDocument = await loadParser();
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
  const parseDocument = await loadParser();

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
  const parseDocument = await loadParser();

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
  const parseDocument = await loadParser();

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
  const parseDocument = await loadParser();

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
  const parseDocument = await loadParser();

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
