# Media Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить локальные изображения, видео и аудио к темам и вопросам, редактируемые `.tiqui`-проекты и единый offline ZIP для ученика.

**Architecture:** Сохранить текстовый шаблон источником структуры Course, расширив parser декларативными MediaSlot. Скрыть Blob/object URL lifecycle в MediaRegistry, ZIP/manifest/security — в CoursePackage, а media rendering — за `resolveMedia` внутри player. UI связывает слоты с локальными assets и никогда не передаёт бинарные данные parser-у.

**Tech Stack:** Browser-native JavaScript ESM, Node.js >=20.11, npm, fflate (кандидат, фиксированная версия после spike), node:test, Playwright Chromium, custom single-file builder.

**Spec:** `docs/superpowers/specs/2026-10-27-media-support-design.md`

## Global Constraints

- Поддерживать актуальные Chromium-based desktop-браузеры; Edge проверять release smoke-тестом, Firefox/Safari/mobile считать best-effort.
- Принимать только локальные JPEG/PNG/WebP (<=15 МБ), MP3/M4A (<=50 МБ), MP4 H.264/AAC (<=250 МБ).
- Считать 500 МБ целевым total limit и подтвердить/скорректировать его Task 1 до реализации UI.
- Не добавлять внешние URL, autoplay, media transcoding, обязательное дослушивание/просмотр или media в post-answer explanation.
- Всегда экспортировать student ZIP; не сохранять старый single-HTML download как отдельный пользовательский режим.
- Не включать `lesson.md` и `project.json` в student ZIP.
- Сохранить media-free parsing/preview и default prompt-builder behavior.
- Экранировать пользовательские descriptions/filenames и защищать ZIP import от traversal, duplicate paths, excessive entries/sizes/ratios.
- После каждой правки `src/` запускать `make build`; перед завершением каждой задачи запускать её focused tests.
- Каждый коммит заканчивать отдельным trailer: `Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>`.

## Review Focus

- Шаблон меняется после attach, но до применения panel edit становится невалидным: прежний outline остаётся read-only, asset не перепривязывается по позиции (Task 6 browser test).
- `.md` с теми же slot IDs открывается поверх проекта: старые assets полностью очищаются, а slots становятся unresolved (Task 6 browser test).
- ZIP содержит traversal/duplicate/compression-bomb entries: импорт отклоняется транзакционно, текущий проект не меняется (Task 4 unit tests).
- Attach/replacement превышает per-kind или total limit: прежний asset сохраняется и object URL не протекает (Task 3 unit tests).
- Media decode/load падает в student package: description и вопрос остаются доступны, прохождение не блокируется (Task 5 browser test).

---

## File Map

- Create `src/media-template.js` — pure canonical insertion/removal of media metadata blocks by parser source anchor.
- Create `src/media-registry.js` — asset validation, limits, atomic attach/replace/remove, object URL ownership, manifest projection.
- Create `src/course-package.js` — async `.tiqui`/student ZIP creation and transactional project import through an injected ZIP adapter.
- Create `src/student-html.js` — generate student `index.html` from Course, player source and resolved archive paths.
- Create `tests/unit/media-template.test.js`, `media-registry.test.js`, `course-package.test.js`, `student-html.test.js`.
- Create `tests/performance/media-package.spec.js` — opt-in large-archive spike, excluded from normal suite.
- Modify `src/parser.js` — MediaSlot grammar, canonical IDs, validation and lesson/question source anchors.
- Modify `src/player.js` — shared media renderer, lesson intro, question media, resolver and destroy lifecycle.
- Modify `src/app.js` — registry lifecycle, media panel, project/template import/export, prompt controls and ZIP download orchestration.
- Modify `src/quiz.template.html` — renamed controls, project inputs, media panel/dialog/progress UI and prompt media options.
- Modify `scripts/build.js` — include selected ZIP browser bundle and new source modules in deterministic order.
- Modify `package.json`, `package-lock.json` — exact ZIP dependency and scripts for opt-in performance test.
- Modify `tests/browser/editor.spec.js`, `player.spec.js`, `security.spec.js`; create `tests/browser/media.spec.js`.
- Modify `README.md` — user-facing “шаблон” terminology, `.tiqui`, ZIP extraction, formats/limits and desktop support.
- Regenerate `quiz.html` only through `make build`.

### Task 1: Prove ZIP dependency, build integration and safe total limit

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/build.js`
- Create: `tests/performance/media-package.spec.js`
- Modify: `.gitignore` only if the spike produces a new local artifact directory
- Regenerate: `quiz.html`

**Interfaces:**
- Produces: browser-global ZIP adapter passed later to `createCoursePackage(zipAdapter)`; documented measured total-size limit.
- Produces: `npm run test:media-performance`, gated from `npm test` and requiring `TIQUI_MEDIA_PERF=1`.

- [ ] **Step 1: Add an exact candidate `fflate` version and inspect its browser bundle entry**

Run `npm install --save-dev --save-exact fflate@<selected-version>` only after confirming the package exposes a distributable UMD/browser build. Do not import npm ESM directly into runtime modules.

- [ ] **Step 2: Add the failing build-consistency expectation**

Extend the build check or a focused Node test to assert that generated `quiz.html` contains the ZIP adapter exactly once and still contains no unresolved bare `fflate` import.

- [ ] **Step 3: Run the build check and confirm RED**

Run: `npm run check:build`

Expected: FAIL because the new vendor input is not included in `quiz.html`.

- [ ] **Step 4: Include the browser bundle as an explicit build input**

Update `scripts/build.js` to read the resolved browser bundle, place it before project modules, and preserve deterministic output. Keep `src/app.js` free of bare package imports.

- [ ] **Step 5: Add the opt-in performance scenario**

Create a Playwright spec that, only when `TIQUI_MEDIA_PERF=1`, generates representative incompressible blobs for one 250 МБ video-shaped asset and a 500 МБ total archive; record generation time, page responsiveness and success/failure without committing output files.

- [ ] **Step 6: Run the spike in Chromium and record the decision in the spec**

Run: `TIQUI_MEDIA_PERF=1 npx playwright test tests/performance/media-package.spec.js --project=chromium --workers=1`

Expected: PASS without page crash. If it fails or memory is unsafe, stop and edit the spec/global limits to the largest repeatably safe value before Task 2.

- [ ] **Step 7: Verify deterministic build**

Run: `make build && make check-build`

Expected: `quiz.html is up to date`.

- [ ] **Step 8: Commit the spike-backed dependency decision**

```bash
git add package.json package-lock.json scripts/build.js tests/performance/media-package.spec.js quiz.html .gitignore
git commit -m "feat: add browser zip foundation" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 2: Add MediaSlot grammar and safe template-edit helpers

**Files:**
- Modify: `src/parser.js`
- Create: `src/media-template.js`
- Modify: `tests/unit/parser.test.js`
- Create: `tests/unit/media-template.test.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Produces: `lesson.media` / `question.media` as `{ id, kind, description }`.
- Produces: `lesson.line` and existing `question.line` as zero-based heading anchors.
- Produces: `upsertMediaBlock(source, { line, scope }, media) -> string` and `removeMediaBlock(source, { line, scope }) -> string`.

- [ ] **Step 1: Write parser tests for valid slots and coexistence**

Add tests asserting a lesson slot and question slot in the same lesson parse to exact objects, existing media-free fixtures remain unchanged, and normalized slot IDs remain stable.

- [ ] **Step 2: Write parser tests for invalid media metadata**

Cover unknown kind, empty/orphan/repeated fields, missing description, second slot on one owner, duplicate normalized ID across owners, media after question text, and lesson metadata placement after existing icon/description/ID.

- [ ] **Step 3: Run parser tests and confirm RED**

Run: `node --test tests/unit/parser.test.js`

Expected: new media assertions FAIL while existing assertions remain green.

- [ ] **Step 4: Extend `parseDocument(source)` minimally**

Parse `Медиа: <kind>:<id>` and `Описание медиа: <text>` only in the allowed metadata regions. Canonicalize ID once with `slug`, attach a slot only after both fields validate, track duplicate IDs across the Course, and include lesson heading anchors.

- [ ] **Step 5: Run parser tests and confirm GREEN**

Run: `node --test tests/unit/parser.test.js`

Expected: PASS.

- [ ] **Step 6: Write failing media-template helper tests**

Assert canonical insertion after lesson metadata or directly after question heading, replacement without duplicate fields, removal of both fields, preservation of unrelated whitespace/content, CRLF normalization consistent with parser, and refusal to edit a stale/mismatched anchor.

- [ ] **Step 7: Implement pure template edits**

Implement the two exported functions without DOM access. Require the caller to provide an anchor from the current valid parse; return a structured error or throw a documented domain error when the heading no longer matches.

- [ ] **Step 8: Verify unit suite and build**

Run: `make test-unit && make build && make check-build`

Expected: all unit tests pass and generated artifact is current.

- [ ] **Step 9: Commit**

```bash
git add src/parser.js src/media-template.js tests/unit/parser.test.js tests/unit/media-template.test.js quiz.html
git commit -m "feat: add media slots to templates" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 3: Implement MediaRegistry lifecycle and validation

**Files:**
- Create: `src/media-registry.js`
- Create: `tests/unit/media-registry.test.js`
- Modify: `scripts/build.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Consumes: canonical `{ id, kind, description }` slots from Task 2.
- Produces: `createMediaRegistry({ createObjectURL, revokeObjectURL, limits? })`.
- Produces registry methods: `attach(slot, file)`, `remove(slotId)`, `get(slotId)`, `validate(course)`, `exportManifest()`, `createPreviewUrl(slotId)`, `revokePreviewUrl(slotId)`, `dispose()`.

- [ ] **Step 1: Write failing policy and lifecycle tests**

Cover allowlisted MIME+extension pairs, 15/50/250 МБ kind limits, selected total limit from Task 1, atomic replacement, preserved previous asset on rejection, missing slot validation, deterministic archive filename, object URL reuse/revoke, remove and dispose.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/unit/media-registry.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `createMediaRegistry`**

Keep DOM and ZIP concerns out. Accept browser URL functions as dependencies for unit testing. Store Files/Blobs in memory, calculate totals before mutation, normalize archive filenames from canonical slot IDs plus canonical extension, and return structured `{ ok, value?, errors? }` results.

- [ ] **Step 4: Run focused and complete unit tests**

Run: `node --test tests/unit/media-registry.test.js && make test-unit`

Expected: PASS.

- [ ] **Step 5: Add the module to deterministic build order and verify**

Run: `make build && make check-build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/media-registry.js tests/unit/media-registry.test.js scripts/build.js quiz.html
git commit -m "feat: manage local media assets" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 4: Implement secure project and student packaging

**Files:**
- Create: `src/course-package.js`
- Create: `tests/unit/course-package.test.js`
- Modify: `scripts/build.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Consumes: registry manifest/assets from Task 3 and injected `zipAdapter` from Task 1.
- Produces: `createCoursePackage(zipAdapter, { digest, limits? })`.
- Produces async methods `openProject(file, { signal, onProgress })`, `saveProject({ source, course, registry }, opts)`, `exportStudentCourse({ course, registry, indexHtml }, opts)` returning `Promise<Result<...>>`.

- [ ] **Step 1: Write failing project round-trip tests**

Assert `.tiqui` contains UTF-8 `project.json`, `lesson.md`, and deterministic `media/` entries; reopening restores source and assets; SHA-256, MIME and size are verified; unresolved slots survive without fake assets.

- [ ] **Step 2: Write failing student package tests**

Assert every student export returns ZIP containing `index.html`; media-free ZIP has only `index.html`; media ZIP contains expected `media/` entries; neither includes `lesson.md`, `project.json` or an answer file.

- [ ] **Step 3: Write failing hostile archive tests**

Cover `../`, absolute paths, backslashes, duplicate normalized paths, unsupported manifest version, too many entries, declared/actual size mismatch, excessive uncompressed total/compression ratio, corrupt checksum, abort signal and corrupt ZIP. Assert failed import returns errors and no partially restored project.

- [ ] **Step 4: Run focused tests and confirm RED**

Run: `node --test tests/unit/course-package.test.js`

Expected: FAIL because module is missing.

- [ ] **Step 5: Implement `createCoursePackage`**

Use async adapter calls and progress callbacks. Keep validation pure where possible. Use Web Crypto-compatible injected `digest`; store already-compressed media without recompression where supported. Return complete candidate project data and leave UI swapping to caller.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `node --test tests/unit/course-package.test.js`

Expected: PASS.

- [ ] **Step 7: Verify all unit tests and build**

Run: `make test-unit && make build && make check-build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/course-package.js tests/unit/course-package.test.js scripts/build.js quiz.html
git commit -m "feat: package editable and student courses" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 5: Render media in player and generate student index

**Files:**
- Modify: `src/player.js`
- Create: `src/student-html.js`
- Create: `tests/unit/student-html.test.js`
- Modify: `tests/browser/player.spec.js`
- Modify: `tests/browser/player-edge.spec.js`
- Modify: `tests/browser/security.spec.js`
- Modify: `scripts/build.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Consumes: MediaSlot from Task 2 and `resolveMedia(slot) -> string | null`.
- Produces: `createPlayer(host, course, { preview?, resolveMedia? }) -> { destroy() }`.
- Produces: `createStudentHtml(course, mediaPaths) -> string` whose runtime resolves `media/...` paths.

- [ ] **Step 1: Write failing player browser tests**

Cover optional lesson intro with skip button, question media before answer UI, coexistence in one lesson, replay on retry, no autoplay, `preload="metadata"`, image alt/caption, audio/video caption, missing/decode-error fallback and non-blocking answer flow.

- [ ] **Step 2: Write failing lifecycle/security tests**

Assert replacing preview calls prior `destroy`, keyboard handler is removed, descriptions remain inert text, `resolveMedia` receives only parsed slots, and absent resolver renders fallback rather than raw ID/path.

- [ ] **Step 3: Run browser tests and confirm RED**

Run: `npx playwright test tests/browser/player.spec.js tests/browser/player-edge.spec.js tests/browser/security.spec.js --project=chromium`

Expected: new assertions FAIL.

- [ ] **Step 4: Implement shared media renderer and lifecycle**

Add one private renderer used by lesson intro and question header. Use DOM properties/textContent for dynamic attributes/captions. Return idempotent `destroy()` that clears `host.onkeydown` and other player-owned resources.

- [ ] **Step 5: Write failing student HTML unit tests**

Assert script-breaking characters are escaped, player source/CSS is embedded once, media mapping uses only relative safe archive paths, and correct answers are not emitted as a separate obvious file/object label.

- [ ] **Step 6: Implement `createStudentHtml`**

Move the current standalone HTML responsibility out of `src/app.js`; embed Course and media mapping safely, invoke player with relative-path resolver, and keep output deterministic.

- [ ] **Step 7: Run focused tests and build**

Run: `node --test tests/unit/student-html.test.js && npx playwright test tests/browser/player.spec.js tests/browser/player-edge.spec.js tests/browser/security.spec.js --project=chromium && make build && make check-build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/player.js src/student-html.js tests/unit/student-html.test.js tests/browser/player.spec.js tests/browser/player-edge.spec.js tests/browser/security.spec.js scripts/build.js quiz.html
git commit -m "feat: render course media offline" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 6: Add authoring media panel and project lifecycle

**Files:**
- Modify: `src/app.js`
- Modify: `src/quiz.template.html`
- Create: `tests/browser/media.spec.js`
- Modify: `tests/browser/editor.spec.js`
- Modify: `tests/browser/security.spec.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Consumes: parser anchors/template edits (Task 2), MediaRegistry (Task 3), CoursePackage (Task 4), createStudentHtml/player (Task 5).
- Produces: UI actions for template/project import/export, media attach/replace/remove, progress/cancel and export readiness.

- [ ] **Step 1: Write failing terminology and project-control tests**

Assert visible labels are «Импортировать шаблон», «Скачать шаблон», «Открыть проект», «Сохранить проект», «Скачать квиз для ученика» and no user-facing control requires understanding “Markdown”.

- [ ] **Step 2: Write failing media panel tests**

Cover outline for lessons/questions, attach with mandatory description, automatic canonical template edit, immediate preview, replace/remove, per-file and total-size errors, asset total display, and unresolved-slot status.

- [ ] **Step 3: Add Review Focus browser tests**

Assert transient invalid source makes previous outline read-only; valid parse restores editing without retargeting. Assert importing `.md` disposes the old registry even when slot IDs match. Assert failed `.tiqui` import preserves source, preview and assets.

- [ ] **Step 4: Write failing project/student export tests**

Assert `.tiqui` save/reopen round-trip, unfinished project save is allowed, student ZIP is disabled for parser errors/unresolved assets, media-free course still downloads ZIP, progress/cancel UI is available, and generated ZIP filename is stable.

- [ ] **Step 5: Run focused browser tests and confirm RED**

Run: `npx playwright test tests/browser/media.spec.js tests/browser/editor.spec.js tests/browser/security.spec.js --project=chromium`

Expected: new assertions FAIL.

- [ ] **Step 6: Implement registry/project ownership in `src/app.js`**

Create one active registry, dispose it on project replacement/template import, retain last valid anchored outline, destroy prior preview before creating the next, and centralize readiness as `parser valid && registry.validate(course).ok`.

- [ ] **Step 7: Implement panel/dialog/progress markup and handlers**

Use hidden file inputs with exact `accept` values, require description before attach, route all source mutations through `media-template.js`, and keep structural controls disabled while parse is invalid.

- [ ] **Step 8: Implement imports and downloads**

Make `.tiqui` import transactional; make `.md` import destructive only after successful file read and registry disposal; route all student downloads through CoursePackage ZIP, including media-free courses.

- [ ] **Step 9: Run focused browser tests and build**

Run: `npx playwright test tests/browser/media.spec.js tests/browser/editor.spec.js tests/browser/security.spec.js --project=chromium && make build && make check-build`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app.js src/quiz.template.html tests/browser/media.spec.js tests/browser/editor.spec.js tests/browser/security.spec.js quiz.html
git commit -m "feat: add media authoring workflow" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 7: Parameterize prompt-generated media slots

**Files:**
- Modify: `src/app.js`
- Modify: `src/quiz.template.html`
- Modify: `tests/browser/editor.spec.js`
- Regenerate: `quiz.html`

**Interfaces:**
- Consumes: MediaSlot syntax from Task 2.
- Produces: default prompt byte-for-behavior compatible with current no-media intent; opt-in controls for lesson frequency, question frequency and allowed kinds.

- [ ] **Step 1: Write failing default-behavior test**

Assert opening prompt builder with media toggle off produces no `Медиа:`/`Описание медиа:` instructions and retains current topic/audience/count/difficulty requirements.

- [ ] **Step 2: Write failing opt-in matrix tests**

Cover lesson choices `none/some/every`, question choices `none/about-one/several`, one or more selected media kinds, unique slot IDs, required descriptions, prohibition on URL/path/binary generation, and import guidance.

- [ ] **Step 3: Run focused test and confirm RED**

Run: `npx playwright test tests/browser/editor.spec.js --project=chromium -g "prompt"`

Expected: new media prompt assertions FAIL.

- [ ] **Step 4: Add progressive prompt controls and generation logic**

Keep media controls hidden/disabled until opt-in. Require at least one kind when enabled. Generate only text instructions and slot examples; do not change parser/project state from the prompt dialog.

- [ ] **Step 5: Verify focused test and build**

Run: `npx playwright test tests/browser/editor.spec.js --project=chromium -g "prompt" && make build && make check-build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/quiz.template.html tests/browser/editor.spec.js quiz.html
git commit -m "feat: generate optional media slots" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

### Task 8: Complete documentation, security regression and release verification

**Files:**
- Modify: `README.md`
- Modify: `tests/browser/player.spec.js`
- Modify: `tests/browser/media.spec.js`
- Modify: `tests/browser/security.spec.js`
- Modify: `.serena/memories/architecture.md`
- Modify: `.serena/memories/domain_model.md`
- Modify: `.serena/memories/data_flow.md`
- Modify: `.serena/memories/development_guide.md`
- Regenerate: `quiz.html` if source changed during fixes

**Interfaces:**
- Consumes: all prior tasks.
- Produces: documented user workflow and final release evidence.

- [ ] **Step 1: Update user documentation**

Document “шаблон” terminology, `.tiqui` versus student ZIP, archive extraction with `index.html` and `media/` kept together, supported formats/limits, missing-slot behavior, offline desktop scope, prompt media option and current answer-concealment boundary.

- [ ] **Step 2: Add final end-to-end offline scenario**

Create a small fixture with lesson image plus question audio/video, save/reopen project, export ZIP, extract inside the test temp directory, open `index.html`, assert zero external network requests and complete a lesson.

- [ ] **Step 3: Add final hostile-content/archive regression**

Use malicious description/filename and crafted archive entries to prove inert rendering, no unexpected file paths and transactional failure.

- [ ] **Step 4: Run complete verification**

Run: `make build && make test && make audit`

Expected: build current; all unit/browser tests pass; audit has no high-severity finding.

- [ ] **Step 5: Perform manual Chromium-based release smoke-test**

In current Chrome and Edge: open constructor, import/save `.tiqui`, export/extract student ZIP, open `index.html` offline and play JPEG/PNG/WebP, MP3/M4A and MP4 samples. Record browser versions and results in the task handoff, not in durable docs.

- [ ] **Step 6: Update Serena memories through Serena MCP**

Record only stable final architecture/data-flow/development changes, update `mem:core` references if new memories are added, then run `serena memories check`.

- [ ] **Step 7: Inspect staged files and secrets before commit**

Confirm no media fixtures contain private/copyrighted user data, no certificates/secrets are staged, performance artifacts are absent, and only intended files remain.

- [ ] **Step 8: Commit**

```bash
git add README.md tests/browser/player.spec.js tests/browser/media.spec.js tests/browser/security.spec.js quiz.html .serena/memories
git commit -m "docs: document offline media courses" -m "Co-Authored-By: O3 Agent Codex <noreply@ozon.ru>"
```

## Final measured limit correction

The final production lifecycle spike supersedes the library-only Task 1 measurement: 500 MiB failed the heartbeat/RSS budgets. Runtime total is now 250 MiB, with a warning above 125 MiB; per-kind limits remain 15/50/250 MiB. The opt-in test exercises CoursePackage save/open/student export, SHA-256 and retained old/new projects plus archive payloads. Metadata is limited to 2 MiB per file and both exports permit at most 1000 media assets. Real PNG, AAC/M4A and H.264/AAC MP4 are encoded at test runtime and verified for metadata/playback from extracted file URLs.

## Self-Review Result

- Spec coverage: every goal, non-goal, package format, UI flow, prompt option, security requirement, browser scope and documentation item maps to Tasks 1–8.
- Step granularity: each implementation step has one module/interface responsibility and each task ends in focused verification plus a reviewable commit.
- Type consistency: `MediaSlot`, MediaRegistry, CoursePackage, `resolveMedia`, `createStudentHtml` and `destroy()` names are consistent across producer/consumer tasks.
- Review Focus: all five listed failure modes have explicit tests in Tasks 3, 4, 5 and 6.
- Proportion: plan defines contracts and assertions without transcribing implementations; large binary performance evidence remains opt-in.
