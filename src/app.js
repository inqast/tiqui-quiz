import { parseDocument, slug } from './parser.js';
import { createPlayer, PLAYER_CSS } from './player.js';
import { createMediaRegistry } from './media-registry.js';
import { upsertMediaBlock, removeMediaBlock } from './media-template.js';
import { createCoursePackage } from './course-package.js';
import { createStudentHtml } from './student-html.js';
import * as fflate from 'fflate';

const playerStyle = document.createElement('style');
playerStyle.textContent = PLAYER_CSS;
document.head.append(playerStyle);

const source = document.querySelector('#source'), preview = document.querySelector('#preview'), messages = document.querySelector('#messages'), filename = document.querySelector('#filename'), status = document.querySelector('#editStatus');
const workspace = document.querySelector('.workspace'), editorTab = document.querySelector('#editorTab'), previewTab = document.querySelector('#previewTab');
const exportButton = document.querySelector('#exportHtml'), mediaOutline = document.querySelector('#mediaOutline'), mediaPanelStatus = document.querySelector('#mediaPanelStatus'), mediaTotal = document.querySelector('#mediaTotal');
const operationProgress = document.querySelector('#operationProgress'), operationLabel = document.querySelector('#operationLabel'), operationBar = document.querySelector('#operationBar');
const mediaDialog = document.querySelector('#mediaDialog'), mediaKind = document.querySelector('#mediaKind'), mediaDescription = document.querySelector('#mediaDescription'), mediaFile = document.querySelector('#mediaFile'), mediaDialogError = document.querySelector('#mediaDialogError');
const projectPackage = window.__TIQUI_PROJECT_PACKAGE || createCoursePackage(fflate, { digest: (algorithm, bytes) => crypto.subtle.digest(algorithm, bytes) });
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
const mediaLimits = window.__TIQUI_TEST_LIMITS;
const confirmationThreshold = window.__TIQUI_CONFIRM_THRESHOLD ?? 125 * 1024 * 1024;
const createRegistry = () => createMediaRegistry(mediaLimits ? { limits: mediaLimits } : undefined);
let currentName = 'lesson-example.md', timer = null, lastCourse = null, lastOutline = [], registry = createRegistry(), activeOperation = null, pendingOwner = null, sourceRevision = 0;
source.value = starter;
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function humanBytes(bytes) { if (bytes < 1024) return `${bytes} Б`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`; return `${(bytes / 1024 ** 2).toFixed(1)} МБ` }
function downloadBlob(blob, name) { if (window.__TIQUI_DOWNLOAD) { window.__TIQUI_DOWNLOAD(blob, name); return } const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000) }
function downloadText(content, name, type) { downloadBlob(new Blob([content], { type }), name) }
function owners(course) {
  return course.lessons.flatMap((lesson, lessonIndex) => [
    { key: `lesson:${lessonIndex}`, title: `Тема: ${lesson.title}`, anchor: lesson.anchor, media: lesson.media },
    ...lesson.questions.map((question, questionIndex) => ({ key: `question:${lessonIndex}:${questionIndex}`, title: `Вопрос ${questionIndex + 1}: ${question.text || question.type}`, anchor: question.anchor, media: question.media }))
  ]);
}
const assets = () => registry.exportManifest().value || [];
const readiness = () => lastCourse ? registry.validate(lastCourse) : { ok: false, errors: [] };

function refreshExportAvailability() {
  const parsed = parseDocument(source.value);
  exportButton.disabled = Boolean(activeOperation) || parsed.errors.length > 0 || !parsed.course || !registry.validate(parsed.course).ok;
}
function destroyPreview() { preview.__tiquiPlayer?.destroy?.(); preview.innerHTML = '' }
function replaceRegistry(next) { destroyPreview(); registry.dispose(); registry = next }
function renderPreview() {
  destroyPreview();
  if (lastCourse) createPlayer(preview, lastCourse, { preview: true, resolveMedia: slot => registry.createPreviewUrl(slot.id).value || null });
}
function currentOwner(expected, revision) {
  if (activeOperation || revision !== sourceRevision) return null;
  const parsed = parseDocument(source.value);
  if (parsed.errors.length) return null;
  const owner = owners(parsed.course).find(item => item.key === expected.key);
  if (!owner || owner.anchor.line !== expected.anchor.line || owner.anchor.heading !== expected.anchor.heading) return null;
  return owner;
}
function attachToCurrentOwner(expected, revision, file) {
  const owner = currentOwner(expected, revision);
  if (!owner?.media || owner.media.id !== expected.media?.id || owner.media.kind !== expected.media?.kind) {
    return { ok: false, errors: [{ message: 'Шаблон изменился. Выберите медиаслот заново.' }] };
  }
  const result = registry.attach(owner.media, file);
  if (result.ok) sourceRevision++;
  return result;
}
function pruneUnreferencedAssets(course) {
  const referenced = new Set(owners(course).flatMap(owner => owner.media ? [owner.media.id] : []));
  for (const asset of assets()) if (!referenced.has(asset.slotId)) registry.remove(asset.slotId);
}

function renderOutline(valid) {
  valid = valid && !activeOperation;
  const revision = sourceRevision;
  mediaTotal.textContent = humanBytes(assets().reduce((sum, asset) => sum + asset.size, 0));
  mediaPanelStatus.textContent = valid ? '' : 'Исправьте шаблон: медиаслоты временно доступны только для просмотра.';
  mediaOutline.replaceChildren();
  lastOutline.forEach(owner => {
    const box = document.createElement('section'); box.className = 'media-owner'; box.dataset.ownerKey = owner.key;
    const head = document.createElement('div'); head.className = 'media-owner-head';
    const title = document.createElement('strong'); title.textContent = owner.title;
    const add = document.createElement('button'); add.className = 'btn secondary'; add.type = 'button'; add.textContent = owner.media ? 'Заменить' : 'Добавить медиа'; add.disabled = !valid; add.onclick = () => openMediaDialog(owner, revision);
    head.append(title, add); box.append(head);
    if (owner.media) {
      const asset = registry.get(owner.media.id).value;
      const slot = document.createElement('div'); slot.className = 'media-slot'; slot.dataset.slotId = owner.media.id;
      const description = document.createElement('div'); description.textContent = owner.media.description;
      const row = document.createElement('div'); row.className = 'media-slot-row';
      const state = document.createElement('span'); state.textContent = asset ? `${asset.filename} · ${humanBytes(asset.size)}` : 'Файл не выбран';
      const input = document.createElement('input'); input.type = 'file'; input.disabled = !valid; input.accept = acceptFor(owner.media.kind); input.setAttribute('aria-label', asset ? 'Заменить' : 'Выбрать файл');
      const error = document.createElement('p'); error.className = 'media-error';
      input.onchange = () => { const result = attachToCurrentOwner(owner, revision, input.files[0]); error.textContent = result.ok ? '' : result.errors.map(item => item.message).join(' '); if (result.ok) update() };
      const remove = document.createElement('button'); remove.className = 'btn secondary'; remove.type = 'button'; remove.textContent = 'Удалить'; remove.disabled = !valid;
      remove.onclick = () => { const current = currentOwner(owner, revision); if (!current?.media) return; destroyPreview(); registry.remove(current.media.id); source.value = removeMediaBlock(source.value, current.anchor); sourceRevision++; update() };
      row.append(state, input, remove); slot.append(description, row, error); box.append(slot);
    }
    mediaOutline.append(box);
  });
}
function update() {
  const parsed = parseDocument(source.value), valid = parsed.errors.length === 0;
  lastCourse = valid ? parsed.course : null;
  if (valid) lastOutline = owners(parsed.course);
  messages.innerHTML = valid ? `<p class="ok">Документ корректен: ${parsed.course.lessons.length} тем, ${parsed.course.lessons.reduce((sum, item) => sum + item.questions.length, 0)} вопросов.</p>` : `<ul class="error">${parsed.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`;
  exportButton.disabled = !valid || !readiness().ok || Boolean(activeOperation);
  renderOutline(valid); renderPreview();
  status.textContent = valid ? 'сохранено локально' : `${parsed.errors.length} ошибок`;
}
function acceptFor(kind) { return kind === 'image' ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' : kind === 'audio' ? '.mp3,.m4a,audio/mpeg,audio/mp4' : '.mp4,video/mp4' }
function openMediaDialog(owner, revision) {
  if (!currentOwner(owner, revision)) return;
  pendingOwner = { owner, revision };
  mediaKind.value = owner.media?.kind || 'image'; mediaDescription.value = owner.media?.description || ''; mediaFile.value = ''; mediaDialogError.textContent = ''; mediaFile.accept = acceptFor(mediaKind.value); mediaDialog.showModal();
}
mediaKind.onchange = () => { mediaFile.accept = acceptFor(mediaKind.value) };
document.querySelector('#confirmMedia').onclick = () => {
  if (!pendingOwner || !lastCourse || activeOperation) return;
  const current = currentOwner(pendingOwner.owner, pendingOwner.revision);
  if (!current) { mediaDialogError.textContent = 'Шаблон изменился. Выберите медиаслот заново.'; return }
  const description = mediaDescription.value.trim(), file = mediaFile.files[0];
  if (!description) { mediaDialogError.textContent = 'Добавьте описание медиа.'; return }
  if (!file) { mediaDialogError.textContent = 'Выберите локальный файл.'; return }
  const base = slug(current.title.replace(/^(Тема|Вопрос \d+):\s*/, '')).slice(0, 48).replace(/-$/, '');
  const used = new Set([...owners(lastCourse).filter(owner => owner.media).map(owner => owner.media.id), ...assets().map(asset => asset.slotId)]);
  let id = current.media?.id || `${base}-media`;
  if (!current.media) for (let suffix = 2; used.has(id); suffix++) id = `${base}-media-${suffix}`;
  const slot = { id, kind: mediaKind.value, description };
  const candidate = upsertMediaBlock(source.value, current.anchor, slot);
  const parsed = parseDocument(candidate);
  if (parsed.errors.length) { mediaDialogError.textContent = parsed.errors.join(' '); return }
  const candidateSlot = owners(parsed.course).find(owner => owner.key === current.key)?.media;
  if (!candidateSlot || candidateSlot.id !== slot.id) { mediaDialogError.textContent = 'Не удалось обновить медиаслот.'; return }
  const result = registry.attach(candidateSlot, file);
  if (!result.ok) { mediaDialogError.textContent = result.errors.map(item => item.message).join(' '); return }
  source.value = candidate; sourceRevision++; pendingOwner = null; mediaDialog.close(); update();
};
source.addEventListener('input', () => { sourceRevision++; status.textContent = 'проверка…'; lastCourse = null; pendingOwner = null; if (mediaDialog.open) mediaDialog.close(); exportButton.disabled = true; renderOutline(false); clearTimeout(timer); timer = setTimeout(update, 250) });
async function importTemplate(file) {
  if (!file) return;
  await runOperation('Импорт шаблона…', async () => ({ ok: true, value: await file.text() }), text => {
    replaceRegistry(createRegistry()); source.value = text; sourceRevision++; currentName = file.name.replace(/\.md$/i, '') + '.md'; filename.textContent = currentName; update();
  });
}
document.querySelector('#fileInput').addEventListener('change', event => importTemplate(event.target.files[0]));
const dropZone = document.querySelector('#dropZone');
['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('drop') }));
['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('drop') }));
dropZone.addEventListener('drop', event => importTemplate(event.dataTransfer.files[0]));
document.querySelector('#saveMd').onclick = () => downloadText(source.value, currentName, 'text/markdown;charset=utf-8');
document.querySelector('#clearEditor').onclick = () => {
  if (activeOperation || !source.value || !window.confirm('Удалить весь текст из редактора? Это действие нельзя отменить.')) return;
  replaceRegistry(createRegistry()); source.value = ''; sourceRevision++; currentName = 'lesson.md'; filename.textContent = currentName; update(); source.focus();
};
function startOperation(label) {
  if (activeOperation) return null;
  const controller = new AbortController(); activeOperation = controller; operationLabel.textContent = label; operationBar.removeAttribute('value'); operationProgress.hidden = false;
  pendingOwner = null;
  if (mediaDialog.open) mediaDialog.close();
  source.disabled = true;
  document.querySelectorAll('#clearEditor, #dropZone button, #dropZone input, #mediaOutline button, #mediaOutline input, #mediaDialog button, #mediaDialog input, #mediaDialog select').forEach(control => { control.disabled = true });
  return controller;
}
function finishOperation(controller) {
  if (activeOperation !== controller) return;
  activeOperation = null;
  operationProgress.hidden = true;
  source.disabled = false;
  document.querySelectorAll('#clearEditor, #dropZone button, #dropZone input, #mediaDialog button, #mediaDialog input, #mediaDialog select').forEach(control => { control.disabled = false });
  renderOutline(Boolean(lastCourse));
  refreshExportAvailability();
}
document.querySelector('#cancelOperation').onclick = () => { const controller = activeOperation; controller?.abort(); if (controller) finishOperation(controller) };
async function runOperation(label, task, success) {
  const controller = startOperation(label); if (!controller) return;
  const revision = sourceRevision, originalSource = source.value, originalRegistry = registry;
  const isCurrent = () => activeOperation === controller && !controller.signal.aborted && sourceRevision === revision && source.value === originalSource && registry === originalRegistry;
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    if (!isCurrent()) return;
    const result = await task(controller.signal, progress => {
      if (activeOperation === controller && progress.total) { operationBar.max = progress.total; operationBar.value = progress.completed }
    });
    if (!isCurrent()) return;
    if (result.ok) success(result.value);
    else document.querySelector('#projectStatus').textContent = `${label.startsWith('Откры') ? 'Не удалось открыть проект' : 'Операция не выполнена'}: ${result.errors?.[0]?.message || 'неизвестная ошибка'}`;
  } catch (error) {
    if (isCurrent()) document.querySelector('#projectStatus').textContent = `${label.startsWith('Откры') ? 'Не удалось открыть проект' : 'Операция не выполнена'}: ${error?.message || 'неизвестная ошибка'}`;
  } finally {
    finishOperation(controller);
  }
}
document.querySelector('#saveProject').onclick = () => {
  if (activeOperation) return;
  const parsed = parseDocument(source.value);
  if (parsed.errors.length) return;
  pruneUnreferencedAssets(parsed.course);
  update();
  runOperation('Сохранение проекта…', (signal, onProgress) => projectPackage.saveProject({ source: source.value, course: parsed.course, registry }, { signal, onProgress }), blob => downloadBlob(blob, `${parsed.course.id || slug(currentName.replace(/\.md$/i, '')) || 'course'}.tiqui`));
};
document.querySelector('#projectInput').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  runOperation('Открытие проекта…', (signal, onProgress) => projectPackage.openProject(file, { signal, onProgress }), candidate => {
    const parsed = parseDocument(candidate.source);
    if (parsed.errors.length) { document.querySelector('#projectStatus').textContent = 'Не удалось открыть проект: шаблон повреждён.'; return }
    const next = createRegistry(), candidateOwners = owners(parsed.course);
    for (const asset of candidate.assets) {
      const slot = candidateOwners.find(owner => owner.media?.id === asset.slotId)?.media;
      if (!slot || !next.attach(slot, new File([asset.blob], asset.filename, { type: asset.mimeType })).ok) { next.dispose(); document.querySelector('#projectStatus').textContent = 'Не удалось открыть проект: медиа повреждено.'; return }
    }
    replaceRegistry(next); source.value = candidate.source; sourceRevision++; currentName = `${slug(parsed.course.title) || 'course'}.md`; filename.textContent = currentName; update();
  });
});
exportButton.onclick = () => {
  if (activeOperation || !lastCourse || !readiness().ok) return;
  const total = assets().reduce((sum, asset) => sum + asset.size, 0);
  if (total > confirmationThreshold && !window.confirm('Медиа весят больше 125 МБ. Подготовить большой архив для ученика?')) return;
  runOperation('Подготовка квиза…', (signal, onProgress) => {
    const paths = Object.fromEntries(assets().map(asset => [asset.slotId, `media/${asset.filename}`]));
    return projectPackage.exportStudentCourse({ course: lastCourse, registry, indexHtml: createStudentHtml(lastCourse, paths) }, { signal, onProgress });
  }, blob => downloadBlob(blob, `${slug(lastCourse.title) || 'quiz'}.zip`));
};

const promptDialog = document.querySelector('#promptDialog');
const promptFields = ['#promptTopic', '#promptAudience', '#promptLessons', '#promptQuestions', '#promptDifficulty'].map(selector => document.querySelector(selector));
const generatedPrompt = document.querySelector('#generatedPrompt');
const copyPromptStatus = document.querySelector('#copyPromptStatus');
const promptMediaEnabled = document.querySelector('#promptIncludeMedia');
const promptMediaOptions = document.querySelector('#promptMediaOptions');
const promptLessonMedia = document.querySelector('#promptLessonMedia');
const promptQuestionMedia = document.querySelector('#promptQuestionMedia');
const promptMediaKinds = [
  ['image', document.querySelector('#promptMediaImage')],
  ['audio', document.querySelector('#promptMediaAudio')],
  ['video', document.querySelector('#promptMediaVideo')],
];
const promptMediaError = document.querySelector('#promptMediaError');
const copyPrompt = document.querySelector('#copyPrompt');
const boundedNumber = (value, fallback) => Math.min(10, Math.max(1, Number.parseInt(value, 10) || fallback));
function updateGeneratedPrompt() {
  const [topic, audience, lessons, questions, difficulty] = promptFields;
  const courseTopic = topic.value.trim() || '[укажите тему курса]';
  const mediaEnabled = promptMediaEnabled.checked;
  const selectedKinds = promptMediaKinds.filter(([, input]) => input.checked).map(([kind]) => kind);
  const mediaValid = !mediaEnabled || selectedKinds.length > 0;
  promptMediaOptions.hidden = !mediaEnabled;
  promptMediaKinds.forEach(([, input]) => { input.disabled = !mediaEnabled });
  promptLessonMedia.disabled = !mediaEnabled;
  promptQuestionMedia.disabled = !mediaEnabled;
  promptMediaError.textContent = mediaValid ? '' : 'Выберите хотя бы один тип медиа.';
  copyPrompt.disabled = !mediaValid;

  const lessonFrequency = {
    none: 'не добавляй вводное медиа к темам',
    some: 'добавь вводное медиа в некоторых темах',
    every: 'добавь вводное медиа в каждой теме',
  }[promptLessonMedia.value];
  const questionFrequency = {
    none: 'не добавляй медиа к вопросам',
    'about-one': 'добавь медиа примерно в одном вопросе на тему',
    several: 'добавь медиа в нескольких вопросах каждой темы',
  }[promptQuestionMedia.value];
  const lessonKind = selectedKinds[0] || 'image';
  const questionKind = selectedKinds[1] || selectedKinds[0] || 'image';
  const mediaExamples = [];
  if (promptLessonMedia.value !== 'none') {
    mediaExamples.push(`Пример для темы (после её Иконки):
Медиа: ${lessonKind}:lesson-1-media
Описание медиа: [обязательное содержательное описание]`);
  }
  if (promptQuestionMedia.value !== 'none') {
    mediaExamples.push(`Пример для вопроса (сразу после заголовка вопроса, перед его текстом):
Медиа: ${questionKind}:question-1-media
Описание медиа: [обязательное содержательное описание]`);
  }
  const mediaInstructions = mediaEnabled && mediaValid ? `

Медиа-слоты:
- ${lessonFrequency};
- ${questionFrequency};
- используй только типы ${selectedKinds.join(' или ')};
- для каждого слота используй ровно две строки «Медиа: тип:уникальный-id» и «Описание медиа: ...»;
- размещай строки медиа только в блоке метаданных владельца: у темы — после её Иконки и остальных метаданных, у вопроса — сразу после заголовка и перед текстом вопроса;
- никогда не размещай медиа внутри или после «Подсказка» или «Объяснение», а также в любом пояснении после ответа;
- дай каждому слоту уникальный ID латиницей; у одной темы или вопроса может быть не более одного медиа, при этом медиа темы и её вопросов могут сочетаться;
- описание обязательно и должно содержательно объяснять материал; для фото оно станет alt-текстом;
- создай только текстовые слоты: не создавай URL, пути к файлам или бинарные данные и не прикладывай медиафайлы;
- не встраивай содержимое файлов как base64 или data: URI;
- пользователь позже импортирует шаблон в Tiqui Quiz и заполнит слоты: выберет локальные файлы для полностью автономной работы.
${mediaExamples.join('\n\n')}` : '';

  generatedPrompt.value = `Создай учебный квиз на тему «${courseTopic}» для аудитории: ${audience.value.trim() || 'школьник'}. Сложность: ${difficulty.value}.

Подготовь ${boundedNumber(lessons.value, 3)} темы, примерно по ${boundedNumber(questions.value, 5)} вопросов в каждой. Используй разные типы вопросов и равномерно распредели их по курсу.

Создай готовый файл lesson.md и приложи его к ответу так, чтобы пользователь мог скачать файл. Внутри файла должен находиться только текстовый шаблон без вводного текста и служебных комментариев. Он должен строго соответствовать формату Tiqui Quiz:

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
${mediaInstructions}

Требования:
- у вопроса «Выбор» должен быть ровно один ответ [x] и не менее двух вариантов;
- у «Порядка» и «Пар» должно быть не менее двух элементов;
- не повторяй варианты, элементы и стороны пар;
- вопросы и объяснения должны быть точными, понятными и соответствовать возрасту;
- не используй персональные данные;
- перед ответом самостоятельно проверь структуру;
- основной результат ответа — скачиваемый файл lesson.md;
- если интерфейс не позволяет приложить файл, выведи содержимое целиком в одном блоке кода с шаблоном, не отображай его как обычный форматированный текст и не добавляй текст вне блока.`;
  copyPromptStatus.textContent = '';
}
promptFields.forEach(field => field.addEventListener('input', updateGeneratedPrompt));
[promptMediaEnabled, promptLessonMedia, promptQuestionMedia, ...promptMediaKinds.map(([, input]) => input)]
  .forEach(field => field.addEventListener('change', updateGeneratedPrompt));
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

