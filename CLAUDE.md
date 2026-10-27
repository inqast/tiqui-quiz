# Repository Task Checklist

## 1. Context & Scope

### Technology baseline

- Работай с браузерным приложением на HTML, CSS и JavaScript ES modules без runtime-фреймворка и backend-компонента.
- Используй Node.js `>=20.11`, npm и ESM (`"type": "module"`) только для разработки, сборки и тестов.
- Сохраняй единственную development-зависимость проекта: Playwright `1.64.0`. Не добавляй и не обновляй зависимости без явного согласования.
- Считай `src/parser.js`, `src/player.js` и `src/app.js` основной бизнес-логикой.
- Считай `src/quiz.template.html` исходной HTML/CSS-оболочкой, `scripts/build.js` — сборщиком, `tests/unit/` и `tests/browser/` — спецификацией поведения.
- Считай `quiz.html` сгенерированным и коммитимым артефактом. Изменяй его только командой `make build` после правок в `src/`.
- Читай проектный контекст через Serena: начни с `mem:core`, затем загружай только относящиеся к задаче `mem:architecture`, `mem:domain_model`, `mem:data_flow`, `mem:development_guide`, `mem:conventions` и `mem:task_completion`.

### Scope and protected paths

- Ограничивай изменения файлами, необходимыми для текущей задачи. Сохраняй пользовательские и несвязанные изменения.
- Не читай и не изменяй `.env`, `.env.*`, `.ssh/`, `.gnupg/`, `.netrc`, приватные ключи, сертификаты, токены, credential-файлы, системные keychain/cookies, историю shell, IDE-кэши и логи.
- Не читай и не изменяй `.idea/`, пользовательские настройки IDE и каталоги вне рабочей области.
- Не изменяй `node_modules/`, `.playwright-browsers/`, `test-results/` и другие генерируемые зависимости или тестовые артефакты.
- Не помещай секреты, сертификаты или реальные приватные данные в исходники, тесты, документацию, артефакты или Git.

## 2. Pre-flight Check

1. Проверь наличие Serena MCP вызовом `initial_instructions` или `get_current_config`.
2. Если Serena MCP или необходимые Serena-инструменты недоступны, остановись до чтения или изменения проекта и попроси пользователя подключить и настроить Serena MCP.
3. Активируй проект `tiqui-learning`, если он ещё не активен. Подтверди корень проекта и TypeScript/JavaScript language server через Serena.
4. Прочитай `mem:core` и только те связанные memories, которые соответствуют задаче. Проверь `list_memories`; при первом знакомстве выполни Serena onboarding.
5. Исследуй релевантный код через `get_symbols_overview`, затем `find_symbol`/`find_declaration`. Не загружай файлы целиком и не используй прямой файловый поиск вместо Serena.
6. Проверь состояние Git и текущую ветку обычными Git-командами. Не трогай несвязанные изменения. Создай отдельную task-ветку только если этого требует пользовательский workflow; не выдумывай отсутствующее правило именования.
7. Зафиксируй ожидаемое поведение и минимальную область изменения. Для bugfix сначала воспроизведи дефект тестом; для новой логики сначала определи тестовые сценарии.
8. Перед первой правкой запусти релевантный baseline: минимум `make test-unit`; для UI, player, импорта, экспорта, persistence или security — также `make test-browser`. Если нужен полный безопасный baseline, выполни `make test`.
9. Если baseline падает до твоих изменений, останови реализацию, сохрани точный вывод и отдели существующую проблему от задачи.

## 3. Architecture & Patterns

### Preserve these patterns

- Сохраняй поток `Markdown -> parseDocument -> validated Course/errors -> preview/export -> createPlayer`.
- Держи грамматику, нормализацию и валидацию документа в `src/parser.js`.
- Держи DOM-оркестрацию конструктора, импорт, preview и экспорт в `src/app.js`.
- Держи learner session, renderers пяти типов вопросов и persistence в `src/player.js`.
- Пропускай в preview и export только Course без ошибок. Сразу инвалидируй `lastCourse` и блокируй экспорт после изменения исходного Markdown.
- Экранируй пользовательский текст в конечной HTML-точке рендеринга. Сохраняй HTML/JavaScript из Markdown инертными данными.
- Изолируй preview-state во временном `Map`; сохраняй реальный прогресс только в namespaced `localStorage`.
- Учитывай, что Course ID и Lesson ID являются частью схемы persistence. Рассматривай изменение ID как миграцию пользовательских данных.
- Сохраняй автономность: опубликованный и экспортированный HTML должен работать без сервера и сети.
- После каждой правки `src/` пересобирай и коммить `quiz.html`.

### Avoid architecture-breaking moves

- Никогда не редактируй `quiz.html` вручную.
- Не обходи `parseDocument` и validation gate ради preview или export.
- Не вставляй Markdown-derived значения напрямую в `innerHTML`, `<script>` или HTML-шаблоны без контекстного экранирования.
- Не смешивай preview-progress с learner `localStorage`.
- Не добавляй backend, API-вызовы, аналитику, аккаунты или сетевую зависимость без явного архитектурного решения пользователя.
- Не переноси parser/player/app responsibilities между модулями без проверки всех вызовов и standalone export.
- Не забывай, что export встраивает `createPlayer.toString()`: проверяй экспортированный HTML после изменения player.
- Не усложняй module syntax без изменения `scripts/build.js`: текущий bundler удаляет только простые top-level `import`/`export` регулярными выражениями.
- Не меняй правила Markdown, типы вопросов, slug/ID или scoring без обновления README, fixtures, unit- и browser-тестов.
- Не интерпретируй отсутствие исключения как успешную persistence/audio-операцию: эти browser API деградируют молча.

## 4. Implementation & Tooling

### Serena-first workflow

1. Используй `get_symbols_overview` для карты неизвестного исходного файла.
2. Используй `find_symbol` с `include_body=true` только для тела символа, которое собираешься понять или изменить.
3. Используй `find_referencing_symbols`, `find_implementations` и `find_declaration` до изменения публичного символа или контракта.
4. Используй `replace_symbol_body` только после чтения текущего тела символа.
5. Используй `insert_before_symbol` или `insert_after_symbol` для добавления декларации рядом с известным символом.
6. Используй `rename_symbol` для переименований и `safe_delete_symbol` для удаления; не выполняй такие рефакторинги текстовой заменой.
7. Используй `replace_in_files` для повторяющихся текстовых правок: сначала `dry_run=true`, затем примени только проверенные occurrence IDs.
8. Используй `search_for_pattern` только когда имя символа неизвестно либо требуется найти literal/config/test text.
9. Используй `get_diagnostics_for_file` после точечных правок поддерживаемого source-файла.
10. Если Serena не поддерживает необходимую операцию, остановись и запроси подключение/расширение Serena; не переходи молча к прямому чтению или редактированию файлов.

### Verification commands

- Выполни `make build` после любого изменения в `src/`.
- Выполни `make check-build`, чтобы доказать соответствие `quiz.html` исходникам.
- Выполни `make test-unit` после изменений parser, grammar, normalization или domain model.
- Выполни `make test-browser` после изменений editor, player, persistence, import/export, responsive layout или security boundaries.
- Выполни `make test` перед завершением любой кодовой задачи.
- Выполни `make audit` при изменении зависимостей или security-sensitive кода.
- Не заявляй о прохождении линтера: отдельный formatter, type checker и conventional linter в проекте не настроены. Следуй существующему стилю и используй тесты, build check, Serena diagnostics и CI security checks.

## 5. Self-Healing & Definition of Done

### When verification fails

1. Сохрани точную упавшую команду, exit code, имя теста и первый полезный stack trace; не скрывай и не сокращай причину ошибки.
2. Определи через Serena символы и поток данных, участвующие в сбое. Используй `find_referencing_symbols` вместо предположений по совпадениям текста.
3. Для browser failure прочитай Playwright trace/artifacts и воспроизведи минимальный сценарий локально. Для parser failure сведи Markdown к минимальному fixture.
4. Проверь, относится ли падение к исходному baseline. Не исправляй несвязанную проблему без согласования.
5. Сформулируй одну проверяемую гипотезу, внеси минимальное изменение через Serena и перезапусти сначала конкретный упавший тест.
6. После локального green перезапусти весь затронутый набор, затем `make test`.
7. Если три последовательные попытки не меняют характер сбоя, остановись, опиши проверенные гипотезы и запроси недостающий контекст вместо случайных правок.

### Definition of Done

- Подтверди, что изменение соответствует запросу и не расширяет scope.
- Подтверди, что все изменённые символы и их callers/consumers проверены через Serena.
- Подтверди, что untrusted content остаётся инертным, а preview/export используют только валидный Course.
- Подтверди, что `quiz.html` пересобран после изменений `src/` и `make check-build` проходит.
- Подтверди свежим выводом, что релевантные тесты и итоговый `make test` проходят.
- Подтверди отсутствие секретов, сертификатов, лишних generated artifacts и несвязанных изменений в staged diff.
- Обнови Serena memories только при появлении устойчивого, неочевидного архитектурного правила или нового рабочего процесса; обнови ссылки из `mem:core`.
- Проверь memory references командой `serena memories check`, если memories менялись.
- Перед коммитом проверь staged file list и staged diff. Создавай коммит только по прямому запросу пользователя и соблюдай установленный формат сообщения и обязательные trailers.
- Перед передачей человеку кратко перечисли изменённые файлы, проверки с результатами, известные ограничения и любые решения, требующие ревью.
