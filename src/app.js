import { parseDocument, slug } from './parser.js';
import { createPlayer, PLAYER_CSS } from './player.js';

const playerStyle = document.createElement('style');
playerStyle.textContent = PLAYER_CSS;
document.head.append(playerStyle);

const source = document.querySelector('#source'), preview = document.querySelector('#preview'), messages = document.querySelector('#messages'), filename = document.querySelector('#filename'), status = document.querySelector('#editStatus');
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
source.addEventListener('input', () => { status.textContent = 'проверка…'; clearTimeout(timer); timer = setTimeout(update, 250) });
document.querySelector('#fileInput').addEventListener('change', event => loadFile(event.target.files[0]));
function loadFile(file) { if (!file) return; const reader = new FileReader(); reader.onload = () => { source.value = String(reader.result); currentName = file.name.replace(/\.md$/i, '') + '.md'; filename.textContent = currentName; update() }; reader.onerror = () => { messages.innerHTML = '<p class="error">Не удалось прочитать файл.</p>' }; reader.readAsText(file) }
const dropZone = document.querySelector('#dropZone');['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('drop') }));['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('drop') })); dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
document.querySelector('#saveMd').onclick = () => download(source.value, currentName, 'text/markdown;charset=utf-8');
document.querySelector('#exportHtml').onclick = () => { if (!lastCourse) return; download(standalone(lastCourse), `${slug(lastCourse.title)}.html`, 'text/html;charset=utf-8') };
update();

