# Media Support Design

## Intent

Добавить в Tiqui Quiz локальные изображения, видео и аудио, сохранив offline-first модель. Автор должен прикреплять один вводный медиаматериал к теме и/или один медиаматериал к отдельным вопросам, сохранять редактируемый проект и выдавать ученику автономный ZIP без исходного шаблона.

## Goals

- Поддержать одно опциональное медиа у каждой темы и одно опциональное медиа у каждого вопроса; оба уровня могут использоваться одновременно.
- Показывать медиа темы перед вопросами и позволять сразу перейти к вопросам без обязательного просмотра до конца.
- Показывать медиа вопроса рядом с формулировкой до ввода ответа.
- Принимать только локальные файлы и гарантировать работу ученического пакета без интернета в современных desktop-браузерах.
- Дать обычному пользователю визуальную панель добавления медиа без ручного редактирования служебного синтаксиса.
- Позволить нейросети опционально создавать описанные медиа-слоты, которые автор заполняет локальными файлами.
- Разделить редактируемый проект автора и ученический архив.
- Сохранить совместимость существующих курсов и текущего prompt-builder по умолчанию.

## Non-goals

- Не добавлять медиа к объяснению после ответа.
- Не требовать просмотра/прослушивания медиа до конца.
- Не поддерживать внешние URL.
- Не перекодировать, не оптимизировать и не редактировать медиа в браузере.
- Не гарантировать offline-открытие ZIP на мобильных устройствах в первой версии.
- Официально поддерживать актуальные Chromium-based desktop-браузеры; bundled Chromium является CI-реализацией, актуальный Edge проходит ручной release smoke-test. Firefox, Safari и mobile остаются best-effort.
- Не обеспечивать криптографическую защиту ответов. Достаточно исключить исходный шаблон и очевидный файл ответов из ученического архива.
- Не превращать текстовый редактор в полноценный визуальный редактор курса.

## Constraints

- Runtime остаётся без backend, API, БД, очередей и аккаунтов.
- Экспорт и импорт выполняются локально в браузере.
- Существующий поток `template -> parseDocument -> Course/errors -> preview/export -> createPlayer` должен сохраниться.
- `quiz.html` остаётся автономным конструктором; добавляемая ZIP-библиотека должна быть включена в его сборку.
- Правильные ответы неизбежно присутствуют в offline runtime-данных. Обфускация откладывается.
- Поддерживаемые форматы первой версии:
  - изображения: JPEG, PNG, WebP;
  - видео: MP4 с H.264/AAC;
  - аудио: MP3 и M4A/AAC.
- Лимиты:
  - изображение — 15 МБ;
  - аудио — 50 МБ;
  - видео — 250 МБ;
  - весь проект — целевой максимум 500 МБ, подтверждаемый performance spike;
  - после 250 МБ показывать предупреждение перед экспортом;
  - если spike не подтверждает стабильную упаковку 500 МБ, снизить лимит до измеренного безопасного значения до реализации UI и документации.

## Approaches considered

### A. Media panel + project/student ZIPs — selected

Текстовый шаблон объявляет media slots. Визуальная панель связывает их с локальными файлами. Редактируемый `.tiqui` и ученический `.zip` формируются раздельно.

Почему выбран: сохраняет текущую архитектуру и читаемый шаблон, поддерживает ручной и AI-assisted сценарии, скрывает файловую упаковку от пользователя и не требует нового визуального редактора всего курса.

### B. Paths written directly in the template — rejected

Автор вручную указывает `media/file.mp4`. Браузер не может повторно получить доступ к файлу по локальному пути; переименования ломают связи; нейросеть генерирует фиктивные пути. Дополнительный registry всё равно потребуется.

### C. Full visual course editor — deferred

Формы становятся главным интерфейсом, а шаблон — импортным форматом. Это даёт лучший UX, но требует перепроектировать редактирование тем, вопросов, reorder, validation и синхронизацию текста. Для media v1 несоразмерно.

## Domain model

### MediaSlot

Декларативное намерение использовать медиа в конкретном месте курса.

- `id`: стабильный уникальный в пределах курса идентификатор.
- `kind`: `image | video | audio`.
- `description`: обязательный пользовательский текст; показывается как подпись, для изображения также используется как `alt`.
- `placement`: определяется владельцем слота — `lesson` или `question`, отдельно в данных не дублируется.

### MediaAsset

Локальный бинарный файл, связанный со слотом только внутри авторского проекта.

- `slotId`.
- `filename`: безопасное имя внутри архива, не исходный локальный путь.
- `mimeType`.
- `size`.
- `bytes`/`Blob` во время открытой browser session.

### Relationships

```text
Course
└── Lesson
    ├── media?: MediaSlot
    └── Questions[]
        └── media?: MediaSlot

Project
├── Course
└── MediaRegistry: slotId -> MediaAsset
```

Слот является частью шаблона и Course. Asset является частью проекта, но не Markdown-модели. Существование слота без asset допустимо в проекте, но запрещает ученический экспорт.

## Template format

Добавить к метаданным темы и вопроса две строки:

```md
Медиа: video:lesson-intro
Описание медиа: Короткое видео о движении планет вокруг Солнца
```

- У темы media fields входят в непрерывный metadata-блок после `##` и существующих `Иконка`/`Описание`/`ID`; у вопроса они располагаются сразу после `###`, до текста вопроса и type-specific rows. Parser принимает `Медиа` и `Описание медиа` в любом порядке внутри этого блока, а UI сериализует канонически `Медиа`, затем `Описание медиа`.
- `Медиа` содержит `kind:slot-id`, а не путь к файлу.
- `Описание медиа` обязательно и должно непосредственно относиться к объявленному слоту.
- Для одной темы или вопроса допускается не более одного слота.
- Slot ID проходит безопасную нормализацию и должен быть уникален в курсе.
- Parser возвращает понятные ошибки для неизвестного kind, orphan/repeated/empty media fields, повторного слота, отсутствующего описания и canonical-ID collision.
- Slot ID нормализуется один раз parser-ом; registry и package используют каноническое значение без повторной нормализации.
- Существующие шаблоны без media fields остаются валидными без миграции.

## Deep modules and seams

### Parser module

Расширить существующий интерфейс `parseDocument(source) -> { course, errors }`. Parser отвечает только за MediaSlot и его инварианты; он не читает файлы и не знает ZIP.

### MediaRegistry module

Новый глубокий модуль скрывает browser file handling:

```js
createMediaRegistry()
registry.attach(slot, file)
registry.remove(slotId)
registry.get(slotId)
registry.validate(course)
registry.exportManifest()
registry.createPreviewUrl(slotId)
registry.revokePreviewUrl(slotId)
registry.dispose()
```

Реализация проверяет MIME/расширение, лимиты, безопасные имена, duplicate assets и владеет object URLs для preview. Attach/replace выполняются атомарно: отклонённый файл не удаляет прежний asset. Интерфейс возвращает структурированные результаты/ошибки, а не напрямую изменяет DOM.

### CoursePackage module

Новый глубокий модуль скрывает ZIP-библиотеку и структуры архивов:

```js
openProject(file, { signal, onProgress }) -> Promise<Result<{ source, assets, manifest }>>
saveProject({ source, course, registry }, { signal, onProgress }) -> Promise<Result<Blob>>
exportStudentCourse({ course, registry }, { signal, onProgress }) -> Promise<Result<Blob>>
```

Все операции асинхронны, отменяемы и сообщают progress. `openProject` транзакционен: текущий проект заменяется только после полной проверки нового архива.

Использовать небольшую browser ZIP-библиотеку (`fflate` как рекомендуемый кандидат), а не собственную реализацию ZIP и не File System Access API. Spike должен подтвердить асинхронную упаковку, память и работу выбранной зависимости внутри `quiz.html`. Текущий regex-bundler не умеет импортировать npm ESM dependency: после spike либо включить проверенный browser bundle библиотеки как явный build input, либо заменить сборщик отдельным согласованным решением; не добавлять обычный bare import в `src/app.js`.

### Player module

Расширить интерфейс до `createPlayer(host, course, { ...options, resolveMedia }) -> { destroy }`. `resolveMedia(slot)` возвращает object URL в preview и относительный `media/...` URL в student runtime; player не знает registry или ZIP. `destroy()` снимает обработчики и освобождает принадлежащие preview ресурсы. Текущие callers остаются совместимыми, поскольку могут игнорировать возвращаемое значение. Добавить единый media renderer, используемый двумя местами:

- lesson intro перед созданием session queue;
- question header перед type-specific renderer.

Type-specific answer renderers остаются неизменными.

## Authoring UI

### Terminology

Пользовательский интерфейс использует слово «шаблон», а не Markdown.

- «Импортировать шаблон» — текущий `.md` import.
- «Скачать шаблон» — текущий `.md` export.
- «Открыть проект» — `.tiqui`.
- «Сохранить проект» — `.tiqui`.
- «Скачать квиз для ученика» — student ZIP для каждого курса, включая курс без медиа; прежний single-HTML download больше не является пользовательским export-сценарием.

`.tiqui` является рекомендуемым форматом сохранения всех редактируемых курсов, включая курсы без медиа. `.md` остаётся совместимым обменным форматом.

### Media panel

- Строить outline из последнего успешно разобранного Course и сохранять source anchors владельцев. При transient parser error показывать прежний outline read-only и запрещать структурные media edits до восстановления валидного parse, чтобы не привязать asset к неверной позиции.
- Для каждого владельца показывать «Добавить медиа» либо имя asset с действиями «Заменить» и «Удалить».
- Добавление открывает выбор одного локального файла и ввод обязательного описания.
- Панель автоматически вставляет/обновляет/удаляет media fields в текстовом шаблоне.
- После изменения шаблон проходит обычный parser/update flow; панель не мутирует Course напрямую.
- Показывать состояние слота: заполнен, не заполнен, неверный тип/размер, потерян после импорта `.md`.
- Показывать суммарный объём assets.

### Preview and validation

- Незаполненный слот показывает безопасную заглушку с описанием.
- Проект можно сохранить с незаполненными слотами.
- Student export блокируется, если parser errors не пусты либо `MediaRegistry.validate(course)` сообщает хотя бы об одном незаполненном/невалидном слоте.
- После любого изменения шаблона или registry немедленно инвалидировать ранее подготовленный export state.

## Prompt builder

- По умолчанию сохранять текущий prompt без media instructions.
- Добавить выключенный по умолчанию переключатель «Добавить места для медиа».
- При включении показать:
  - вводное медиа для тем: `ни для одной | для некоторых | для каждой`;
  - медиа в вопросах: `нет | примерно один вопрос в теме | несколько вопросов в теме`;
  - разрешённые виды: фото, видео, аудио (multi-select).
- Prompt просит модель создавать MediaSlot с уникальным ID и обязательным описанием, но не генерировать путь, URL или бинарный файл.
- После импорта AI-generated шаблона media panel показывает незаполненные слоты для локального заполнения.

## Project package

`course-name.tiqui` является ZIP-контейнером с версионированным manifest:

```text
course-name.tiqui
├── project.json
├── lesson.md
└── media/
    ├── lesson-intro.mp4
    └── mercury-photo.webp
```

`project.json` — UTF-8 JSON с `formatVersion: 1`, mapping `slotId -> archived filename`, MIME type, size и SHA-256 checksum (Web Crypto). Не хранить локальные пути. При импорте проверять version, entry count, paths, duplicate normalized names, declared/uncompressed sizes, compression ratio и отсутствие path traversal. Медиа entries сохранять без бесполезной повторной компрессии там, где библиотека это позволяет.

Импорт обычного шаблона `.md` очищает и освобождает текущий MediaRegistry, чтобы совпавшие slot IDs случайно не унаследовали старые assets. Ошибочный `.tiqui` импорт остаётся транзакционным и сохраняет текущий проект.

## Student package

```text
course-name.zip
├── index.html
└── media/
    ├── lesson-intro.mp4
    └── mercury-photo.webp
```

- Не включать `lesson.md`, `project.json` или отдельный файл ответов.
- `index.html` содержит runtime Course data и ссылается на assets относительными безопасными путями.
- Имя каждого файла определяется registry/package module, а не пользовательским локальным путём.
- Ответы остаются доступны техническому пользователю внутри offline runtime; это принятая граница v1.

## Player behavior

### Lesson media

- После выбора темы показать intro screen с media, обязательным description и кнопкой «Перейти к вопросам».
- Не ждать `ended`; просмотр можно пропустить.
- После возврата к списку тем intro снова доступно при повторном старте.

### Question media

- Показывать после question label и до текста/ответов либо вместе с формулировкой в одном header region.
- Не связывать playback state с ready/check logic.
- При повторе ошибочного вопроса показывать media снова.

### Rendering

- Image: responsive `<img>`, обязательный `alt`, без HTML из description.
- Audio: native `<audio controls preload="metadata">` и видимая подпись.
- Video: native `<video controls preload="metadata" playsinline>` и видимая подпись.
- Не использовать autoplay.
- Ошибка загрузки показывает описание и понятное сообщение, не блокируя вопрос.

## Security

- Доверять только allowlist MIME + extension pair; не исполнять SVG, HTML или другие активные форматы.
- Не использовать исходные filenames как archive paths без нормализации.
- Запрещать absolute paths, `..`, backslashes и duplicate normalized paths при ZIP import.
- Ограничивать число entries, размер каждого entry, declared/uncompressed total и compression ratio для защиты от ZIP bombs.
- Не вставлять description или filename в `innerHTML` без escaping; предпочтительно использовать `textContent` и DOM properties.
- Освобождать созданные object URLs при замене asset, закрытии/открытии проекта и уничтожении preview.
- Не отправлять файлы или metadata во внешние сервисы.

## Failure handling

- Unsupported/oversized file: отклонить attach, сохранить текущий asset, показать конкретный лимит.
- Corrupt `.tiqui`: не заменять открытый проект, перечислить ошибки импорта.
- Missing asset in project: открыть проект с незаполненным slot и заблокировать student export.
- Archive generation failure/out-of-memory: не терять текущий проект, предложить уменьшить видео и повторить.
- Media decode failure: сохранить asset, показать ошибку preview и позволить заменить его.

## Testing strategy

### Unit

- Parser: lesson/question slots, both placements together, missing description, unknown kind, duplicate ID, repeated slot, backward compatibility.
- MediaRegistry: MIME/extension allowlist, per-kind/total limits, safe names, replace/remove, missing assets, object URL cleanup.
- CoursePackage: manifest versioning, round-trip project, student file list, path traversal, duplicate entries, ZIP bomb limits, corrupt archives.

### Browser

- Add/replace/remove media through panel and verify template updates.
- Import generated template with empty slots, fill locally, preview both placements.
- Save `.tiqui`, reopen, verify source and assets.
- Export student ZIP, inspect entries, open extracted `index.html`, play each media kind offline.
- Confirm student ZIP excludes `lesson.md` and project manifest.
- Confirm export is blocked for missing assets and enabled after resolution.
- Confirm existing media-free template, prompt, preview and standalone behavior remain compatible where intended.
- Security cases: hostile filename/description, active file types, malicious ZIP paths, oversized archives.

### Performance spike before implementation

- Measure selected ZIP library with representative 250 МБ video and 500 МБ total project on supported desktop browsers.
- Record peak memory, generation time and whether asynchronous API keeps UI responsive.
- If 500 МБ cannot be packaged reliably, revise the agreed total limit before implementation rather than silently weakening it.

## Delivery and documentation

- Update README user language from Markdown to «шаблон» where addressing nontechnical users; retain technical Markdown description in format reference.
- Document `.tiqui` versus student `.zip`, supported formats/limits, desktop offline extraction steps, media-slot workflow and prompt-builder option.
- Add a clear instruction: extract the entire student archive, keep `index.html` and `media/` together, then open `index.html`.
- Explain that mobile offline use is outside v1 guarantees.

## Decisions made by the designer

- Use a versioned `project.json` even though v1 could infer mapping from filenames; explicit versioning makes project migration and validation local to CoursePackage.
- Store checksums in project manifest to detect missing/corrupt assets; do not use them as security signatures.
- Keep media descriptions visible to learners, because the same text provides context, fallback and image accessibility.
- Treat `.tiqui` as ZIP with a product-specific extension so users distinguish an editable project from the student package.

## Acceptance criteria

- Existing media-free courses continue to parse and preview; student export intentionally changes format from one HTML file to ZIP containing `index.html`.
- An author can attach supported local media to a lesson and to selected questions in the same lesson without writing syntax manually.
- The author can save and reopen a `.tiqui` project with all files and unresolved slots preserved.
- Student export is impossible while any declared slot lacks a valid asset.
- The extracted student archive runs without network access in supported desktop browsers and plays all supported media types.
- Student ZIP contains neither source template nor project manifest.
- Prompt builder remains unchanged by default and creates valid described slots when media options are enabled.
- Full test suite, security cases and build consistency checks pass.
