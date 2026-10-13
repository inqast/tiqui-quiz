import { parseDocument, slug } from './parser.js';
import { createPlayer, PLAYER_CSS } from './player.js';

const playerStyle = document.createElement('style');
playerStyle.textContent = PLAYER_CSS;
document.head.append(playerStyle);

const source = document.querySelector('#source'), preview = document.querySelector('#preview'), messages = document.querySelector('#messages'), filename = document.querySelector('#filename'), status = document.querySelector('#editStatus');
const workspace = document.querySelector('.workspace'), editorTab = document.querySelector('#editorTab'), previewTab = document.querySelector('#previewTab');
function setMobileView(view) {
  workspace.dataset.mobileView = view;
  editorTab.setAttribute('aria-selected', String(view === 'editor'));
  previewTab.setAttribute('aria-selected', String(view === 'preview'));
}
editorTab.onclick = () => setMobileView('editor');
previewTab.onclick = () => setMobileView('preview');
const starter = `# Название квиза

Иконка: 🚀
Описание: Короткое описание курса для ученика
ID: demonstration-quiz

## Первая тема

Иконка: 🌟

### Выбор

Выберите правильный вариант:

- [x] Правильный вариант
  Подсказка: Верно! Здесь можно объяснить, почему этот вариант правильный.
- [ ] Неправильный вариант
  Подсказка: Здесь можно дать полезное пояснение к ошибке.
- [ ] Ещё один вариант
  Подсказка: Подсказка показывается только после проверки ответа.

Объяснение: Общее объяснение вопроса можно написать отдельной строкой.

### Правда или ложь

Это пример утверждения, которое является правдивым.

Ответ: правда
Если правда: Отлично! Это правильный ответ.
Если ложь: Попробуйте ещё раз и обратите внимание на формулировку.
Объяснение: После проверки здесь появится дополнительное пояснение.

### Ввод

Введите один из допустимых ответов:

Ответы: первый ответ | второй ответ | сокращённый ответ
Подсказка: Можно перечислить несколько правильных формулировок через вертикальную черту.
Объяснение: Регистр букв и повторные пробелы не влияют на проверку.

## Вторая тема

Иконка: 🧩

### Порядок

Расположите элементы в правильном порядке:

1. Первый элемент
2. Второй элемент
3. Третий элемент
4. Четвёртый элемент

Объяснение: В документе элементы записываются правильно, а квиз перемешивает их автоматически.

### Пары

Соедините элементы из левого и правого столбцов:

- Первый термин => Первое определение
- Второй термин => Второе определение
- Третий термин => Третье определение

Объяснение: Левая и правая части пары разделяются символами =>.
`;
let currentName = 'lesson-example.md', timer = null, lastCourse = null; source.value = starter;
function update() { const parsed = parseDocument(source.value); lastCourse = parsed.errors.length ? null : parsed.course; messages.innerHTML = parsed.errors.length ? `<ul class="error">${parsed.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : `<p class="ok">Документ корректен: ${parsed.course.lessons.length} тем, ${parsed.course.lessons.reduce((sum, item) => sum + item.questions.length, 0)} вопросов.</p>`; document.querySelector('#exportHtml').disabled = !lastCourse; preview.innerHTML = ''; if (lastCourse) createPlayer(preview, lastCourse, { preview: true }); status.textContent = parsed.errors.length ? `${parsed.errors.length} ошибок` : 'сохранено локально' }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function download(content, name, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000) }
function standalone(course) {
  const json = JSON.stringify(course).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const scriptOpen = '<scr' + 'ipt>';
  const scriptClose = '</scr' + 'ipt>';
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(course.title)}</title><style>html,body{margin:0;min-height:100%;background:#f7f7f2}${PLAYER_CSS}</style></head><body><main id="quiz"></main>${scriptOpen}const COURSE=${json};(${createPlayer.toString()})(document.querySelector('#quiz'),COURSE);${scriptClose}</body></html>`;
}
source.addEventListener('input', () => { status.textContent = 'проверка…'; lastCourse = null; document.querySelector('#exportHtml').disabled = true; clearTimeout(timer); timer = setTimeout(update, 250) });
document.querySelector('#fileInput').addEventListener('change', event => loadFile(event.target.files[0]));
function loadFile(file) { if (!file) return; const reader = new FileReader(); reader.onload = () => { source.value = String(reader.result); currentName = file.name.replace(/\.md$/i, '') + '.md'; filename.textContent = currentName; update() }; reader.onerror = () => { messages.innerHTML = '<p class="error">Не удалось прочитать файл.</p>' }; reader.readAsText(file) }
const dropZone = document.querySelector('#dropZone');['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('drop') }));['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('drop') })); dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
document.querySelector('#saveMd').onclick = () => download(source.value, currentName, 'text/markdown;charset=utf-8');
document.querySelector('#clearEditor').onclick = () => {
  if (!source.value || !window.confirm('Удалить весь текст из редактора? Это действие нельзя отменить.')) return;
  source.value = '';
  update();
  source.focus();
};
document.querySelector('#exportHtml').onclick = () => { if (!lastCourse) return; download(standalone(lastCourse), `${slug(lastCourse.title)}.html`, 'text/html;charset=utf-8') };

const promptDialog = document.querySelector('#promptDialog');
const promptFields = ['#promptTopic', '#promptAudience', '#promptLessons', '#promptQuestions', '#promptDifficulty'].map(selector => document.querySelector(selector));
const generatedPrompt = document.querySelector('#generatedPrompt');
const copyPromptStatus = document.querySelector('#copyPromptStatus');
const boundedNumber = (value, fallback) => Math.min(10, Math.max(1, Number.parseInt(value, 10) || fallback));
function updateGeneratedPrompt() {
  const [topic, audience, lessons, questions, difficulty] = promptFields;
  const courseTopic = topic.value.trim() || '[укажите тему курса]';
  generatedPrompt.value = `Создай учебный квиз на тему «${courseTopic}» для аудитории: ${audience.value.trim() || 'школьник'}. Сложность: ${difficulty.value}.

Подготовь ${boundedNumber(lessons.value, 3)} темы, примерно по ${boundedNumber(questions.value, 5)} вопросов в каждой. Используй разные типы вопросов и равномерно распредели их по курсу.

Создай готовый файл lesson.md и приложи его к ответу так, чтобы пользователь мог скачать файл. Внутри файла должен находиться только Markdown-документ без вводного текста и служебных комментариев. Он должен строго соответствовать формату Tiqui Quiz:

# Название курса
Иконка: один подходящий эмодзи
Описание: краткое описание
ID: короткий-уникальный-id-латиницей

## Название темы
Иконка: один подходящий эмодзи

### Выбор
Текст вопроса
- [x] Единственный правильный вариант
  Подсказка: полезное объяснение после проверки
- [ ] Неправильный вариант
  Подсказка: почему этот вариант не подходит
Объяснение: общий полезный факт

### Правда или ложь
Текст утверждения
Ответ: правда
Если правда: пояснение
Если ложь: пояснение
Объяснение: общий полезный факт

### Ввод
Текст вопроса
Ответы: основной ответ | допустимый вариант
Подсказка: помощь после проверки
Объяснение: общий полезный факт

### Порядок
Текст задания
1. Первый элемент
2. Второй элемент
3. Третий элемент
Объяснение: почему порядок именно такой

### Пары
Текст задания
- Первый термин => Первое соответствие
- Второй термин => Второе соответствие
- Третий термин => Третье соответствие
Объяснение: общий полезный факт

Требования:
- у вопроса «Выбор» должен быть ровно один ответ [x] и не менее двух вариантов;
- у «Порядка» и «Пар» должно быть не менее двух элементов;
- не повторяй варианты, элементы и стороны пар;
- вопросы и объяснения должны быть точными, понятными и соответствовать возрасту;
- не используй персональные данные;
- перед ответом самостоятельно проверь структуру;
- основной результат ответа — скачиваемый файл lesson.md;
- если интерфейс не позволяет приложить файл, выведи содержимое целиком в одном блоке кода с языком markdown, не отображай его как обычный форматированный текст и не добавляй текст вне блока.`;
  copyPromptStatus.textContent = '';
}
promptFields.forEach(field => field.addEventListener('input', updateGeneratedPrompt));
document.querySelector('#openPromptBuilder').onclick = () => { updateGeneratedPrompt(); promptDialog.showModal(); document.querySelector('#promptTopic').focus() };
document.querySelector('#closePromptBuilder').onclick = () => promptDialog.close();
promptDialog.addEventListener('click', event => { if (event.target === promptDialog) promptDialog.close() });
document.querySelector('#copyPrompt').onclick = async () => {
  try {
    await navigator.clipboard.writeText(generatedPrompt.value);
  } catch {
    generatedPrompt.select();
    document.execCommand('copy');
    generatedPrompt.setSelectionRange(0, 0);
  }
  copyPromptStatus.textContent = 'Скопировано';
};
update();

