export function slug(value) { return String(value).toLocaleLowerCase('ru').normalize('NFKC').replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'quiz' }
export function parseDocument(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const errors = []; let course = null, lesson = null, question = null, section = 'course', missingLesson = false, missingQuestionType = false;
  let lessonMedia = null, questionMedia = null, questionMetadataOpen = false;
  const mediaIds = new Set();
  const lineError = (line, message) => errors.push(`Строка ${line + 1}: ${message}`);
  const canonical = value => value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const duplicates = values => values.length !== new Set(values.map(canonical)).size;
  const meta = (target, key, value, line) => { if (!target) return false; const normalized = key.toLocaleLowerCase('ru'); if (normalized === 'иконка') { if (value) target.icon = value; } else if (normalized === 'описание') target.description = value; else if (normalized === 'id') target.id = slug(value); else if (question && normalized === 'объяснение') question.explanation = value; else if (question && normalized === 'подсказка') question.hint = value; else return false; return true };
  const mediaField = key => ['медиа', 'описание медиа'].includes(key.toLocaleLowerCase('ru'));
  const addMediaField = (state, owner, key, value, line) => {
    const normalized = key.toLocaleLowerCase('ru');
    const current = state ?? { owner, mediaSeen: false, descriptionSeen: false, invalid: false };
    if (normalized === 'медиа') {
      if (current.mediaSeen) {
        lineError(line, 'поле «Медиа» указано повторно; для одной темы или вопроса допустим только один слот');
        current.invalid = true;
        return current;
      }
      current.mediaSeen = true;
      current.mediaLine = line;
      if (!value) {
        lineError(line, 'поле «Медиа» не может быть пустым');
        current.invalid = true;
        return current;
      }
      const parts = value.match(/^([^:]+):([^:]+)$/);
      if (!parts) {
        lineError(line, 'поле «Медиа» должно иметь формат kind:slot-id');
        current.invalid = true;
        return current;
      }
      const kind = parts[1].trim().toLocaleLowerCase('ru');
      const rawId = parts[2].trim();
      if (!['image', 'video', 'audio'].includes(kind)) {
        lineError(line, 'вид медиа должен быть image, video или audio');
        current.invalid = true;
      }
      if (!rawId || !/[a-zа-яё0-9]/i.test(rawId.normalize('NFKC'))) {
        lineError(line, 'идентификатор медиа не может быть пустым');
        current.invalid = true;
      }
      current.kind = kind;
      current.id = slug(rawId);
      return current;
    }
    if (current.descriptionSeen) {
      lineError(line, 'поле «Описание медиа» указано повторно');
      current.invalid = true;
      return current;
    }
    current.descriptionSeen = true;
    current.descriptionLine = line;
    current.description = value;
    if (!value) {
      lineError(line, 'поле «Описание медиа» не может быть пустым');
      current.invalid = true;
    }
    return current;
  };
  const finishMedia = state => {
    if (!state) return;
    if (!state.mediaSeen) {
      lineError(state.descriptionLine, '«Описание медиа» указано без поля «Медиа»');
      return;
    }
    if (!state.descriptionSeen) {
      lineError(state.mediaLine, 'для медиа укажите «Описание медиа»');
      return;
    }
    if (state.invalid) return;
    if (mediaIds.has(state.id)) {
      lineError(state.mediaLine, `идентификатор медиа «${state.id}» уже используется`);
      return;
    }
    mediaIds.add(state.id);
    state.owner.media = { id: state.id, kind: state.kind, description: state.description };
  };
  const finishQuestionMedia = () => {
    finishMedia(questionMedia);
    questionMedia = null;
    questionMetadataOpen = false;
  };
  const finishLessonMedia = () => {
    finishMedia(lessonMedia);
    lessonMedia = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index], text = raw.trim(); if (!text || text.startsWith('<!--') )continue;
    if (/^#\s+/.test(text)) { finishQuestionMedia(); finishLessonMedia(); missingLesson = false; missingQuestionType = false; if (course) { lineError(index, 'название курса встречается повторно'); continue } const title = text.replace(/^#\s+/, '').trim(); course = { version: 1, title, icon: '🧩', description: '', id: slug(title), lessons: [] }; section = 'course'; continue }
    if (/^##\s+/.test(text)) { finishQuestionMedia(); finishLessonMedia(); missingLesson = false; missingQuestionType = false; if (!course) { lineError(index, 'сначала укажите название курса через #'); continue } const title = text.replace(/^##\s+/, '').trim(); lesson = { title, icon: '📘', id: slug(title), line: index, anchor: { line: index, scope: 'lesson', heading: text }, questions: [] }; course.lessons.push(lesson); question = null; section = 'lesson'; continue }
    if (/^###\s+/.test(text)) { finishQuestionMedia(); finishLessonMedia(); missingQuestionType = false; if (!lesson) { if (!missingLesson) lineError(index, 'вопрос должен находиться внутри темы ##'); missingLesson = true; continue } const label = text.replace(/^###\s+/, '').trim().toLocaleLowerCase('ru'); const types = { 'выбор': 'choice', 'правда или ложь': 'tf', 'правда/ложь': 'tf', 'ввод': 'input', 'порядок': 'order', 'пары': 'match' }; const type = types[label]; if (!type) { lineError(index, `неизвестный тип вопроса «${label}»`); question = null; continue } question = { type, text: '', line: index, anchor: { line: index, scope: 'question', heading: text }, explanation: '', hint: '' }; if (type === 'choice') question.options = []; if (type === 'input') question.answers = []; if (type === 'order') question.items = []; if (type === 'match') question.pairs = []; lesson.questions.push(question); section = 'question'; questionMetadataOpen = true; continue }
    if (missingLesson) continue;
    if (missingQuestionType) continue;
    const field = text.match(/^([^:]+):\s*(.*)$/);
    if (question) {
      if (field && mediaField(field[1].trim())) {
        if (!questionMetadataOpen) {
          lineError(index, 'медиа вопроса можно указывать только сразу после заголовка вопроса');
          continue;
        }
        questionMedia = addMediaField(questionMedia, question, field[1].trim(), field[2].trim(), index);
        continue;
      }
      if (questionMetadataOpen) finishQuestionMedia();
      const choice = text.match(/^-\s*\[([xX ])\]\s*(.*)$/);
      if (choice && question.type === 'choice') {
        const optionText = choice[2].trim();
        if (!optionText) lineError(index, 'вариант ответа не может быть пустым');
        else question.options.push({ text: optionText, correct: choice[1].toLowerCase() === 'x', feedback: '' });
        continue;
      }
      if (/^Подсказка:\s*/i.test(text) && question.type === 'choice') {
        if (!question.options.length) lineError(index, 'подсказка должна следовать после варианта ответа');
        else question.options.at(-1).feedback = text.replace(/^Подсказка:\s*/i, '').trim();
        continue;
      }
      const ordered = text.match(/^\d+[.)]\s*(.*)$/);
      if (ordered && question.type === 'order') {
        const itemText = ordered[1].trim();
        if (!itemText) lineError(index, 'элемент порядка не может быть пустым');
        else question.items.push(itemText);
        continue;
      }
      if (/^-\s*/.test(text) && question.type === 'match') {
        const pairText = text.replace(/^-\s*/, '');
        const separators = pairText.match(/=>/g)?.length ?? 0;
        if (separators !== 1) {
          lineError(index, 'пара должна содержать ровно один разделитель =>');
          continue;
        }
        const [left, right] = pairText.split('=>').map(value => value.trim());
        if (!left || !right) lineError(index, 'обе части пары должны быть заполнены');
        else question.pairs.push({ left, right });
        continue;
      }
      if (field) {
        const key = field[1].trim().toLocaleLowerCase('ru'), value = field[2].trim();
        if (['иконка', 'описание', 'id'].includes(key)) {
          lineError(index, `поле «${field[1].trim()}» можно указывать только сразу после заголовка курса или темы`);
          continue;
        }
        if (key === 'ответ' && question.type === 'tf') {
          if (Object.hasOwn(question, 'answer')) {
            lineError(index, 'ответ указан повторно');
            continue;
          }
          const values = { правда: true, да: true, true: true, ложь: false, нет: false, false: false };
          if (Object.hasOwn(values, value.toLocaleLowerCase('ru'))) question.answer = values[value.toLocaleLowerCase('ru')];
          else lineError(index, 'ответ должен быть «правда» или «ложь»');
          continue;
        }
        if (key === 'если правда' && question.type === 'tf') { question.feedbackTrue = value; continue }
        if (key === 'если ложь' && question.type === 'tf') { question.feedbackFalse = value; continue }
        if ((key === 'ответы' || key === 'ответ') && question.type === 'input') {
          const seen = new Set();
          question.answers = value.split('|').map(item => item.trim()).filter(Boolean).filter(answer => {
            const normalized = canonical(answer);
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          });
          continue;
        }
        if (meta(question, field[1].trim(), value, index)) continue;
      }
      if (!question.text) { question.text = text; continue } lineError(index, 'не удалось распознать строку внутри вопроса'); continue
    }
    if (field && mediaField(field[1].trim())) {
      if (section !== 'lesson' || !lesson) {
        lineError(index, 'медиа можно указывать только у темы или вопроса');
        continue;
      }
      lessonMedia = addMediaField(lessonMedia, lesson, field[1].trim(), field[2].trim(), index);
      continue;
    }
    if (field && meta(section === 'lesson' ? lesson : course, field[1].trim(), field[2].trim(), index)) continue;
    if (section === 'lesson' && lesson) {
      finishLessonMedia();
      lineError(index, 'перед содержимым вопроса укажите его тип: ### Выбор, ### Правда или ложь, ### Ввод, ### Порядок или ### Пары');
      missingQuestionType = true;
      continue;
    }
    lineError(index, 'не удалось распознать строку');
  }
  finishQuestionMedia();
  finishLessonMedia();
  if (!course) return { course: null, errors: ['Добавьте название курса: # Название'] };
  if (!course.lessons.length) errors.push('Добавьте хотя бы одну тему через ## Название темы');
  course.lessons.forEach((item, lessonIndex) => {
    if (!item.questions.length) errors.push(`Тема «${item.title}»: нет вопросов`);
    item.questions.forEach((itemQuestion, questionIndex) => {
      const place = `Тема «${item.title}», вопрос ${questionIndex + 1}`;
      if (!itemQuestion.text) errors.push(`${place}: нет текста вопроса`);
      if (itemQuestion.type === 'choice') {
        const correct = itemQuestion.options.filter(option => option.correct);
        if (itemQuestion.options.length < 2) errors.push(`${place}: нужно хотя бы два варианта`);
        if (correct.length !== 1) errors.push(`${place}: отметьте ровно один правильный вариант [x]`);
        if (duplicates(itemQuestion.options.map(option => option.text))) errors.push(`${place}: варианты ответа не должны повторяться`);
        itemQuestion.answer = itemQuestion.options.findIndex(option => option.correct);
        itemQuestion.options.forEach(option => delete option.correct);
      }
      if (itemQuestion.type === 'tf' && typeof itemQuestion.answer !== 'boolean') errors.push(`${place}: укажите Ответ: правда или Ответ: ложь`);
      if (itemQuestion.type === 'input' && !itemQuestion.answers.length) errors.push(`${place}: укажите Ответы:`);
      if (itemQuestion.type === 'order') {
        if (itemQuestion.items.length < 2) errors.push(`${place}: нужно хотя бы два пункта`);
        if (duplicates(itemQuestion.items)) errors.push(`${place}: элементы порядка не должны повторяться`);
      }
      if (itemQuestion.type === 'match') {
        if (itemQuestion.pairs.length < 2) errors.push(`${place}: нужно хотя бы две пары`);
        if (duplicates(itemQuestion.pairs.map(pair => pair.left))) errors.push(`${place}: левые части пар не должны повторяться`);
        if (duplicates(itemQuestion.pairs.map(pair => pair.right))) errors.push(`${place}: правые части пар не должны повторяться`);
      }
    });
    item.id = `${slug(item.title)}-${lessonIndex + 1}`;
  });
  return { course, errors };
}

