# Data flow

## Authoring and media

1. Author types/imports a template or opens a `.tiqui` project.
2. Parser produces a validated Course and stable MediaSlots. Invalid edits immediately invalidate export while the last valid outline is read-only.
3. Author selects local files. MediaRegistry validates MIME/extension, per-kind and total limits, canonicalizes archive names, and owns preview object URLs.
4. Preview receives the Course plus a resolver backed by the active registry. Lesson media appears before “Перейти к вопросам”; Question media appears before answer controls.
5. Save project hashes referenced assets and streams `project.json`, `lesson.md`, and `media/` into `.tiqui`.
6. Open project validates archive paths and duplicates, manifest schema/canonical names, limits, hashes, source slot references, and orphans before atomically swapping active source/registry. Failure or cancellation preserves prior state.
7. Student export requires every declared slot resolved, generates offline `index.html`, and streams a ZIP with only runtime files.
8. Learner fully extracts ZIP and opens `index.html` via `file://`; media resolves from sibling `media/` with zero external requests.

## Concurrency and cleanup

- Template import and package operations disable source/media mutation controls and use AbortSignal plus operation identity, source revision/text and registry identity checks. Late success/failure/cancellation cannot overwrite newer state or publish a stale download.
- UI attachment allocates an unused canonical slot ID across current slots and registry, validates candidate source first, then commits source and asset synchronously.
- The performance spike uses the production CoursePackage lifecycle with the old project, imported result, archive and student ZIP retained. The 500 MiB target failed RSS/responsiveness; the supported total is 250 MiB.
- Replacing/removing/importing/disposal revokes obsolete object URLs. Registry replacement accounts for old asset size before total-limit validation.
- Operations above 125 MiB ask for confirmation; the opt-in 250 MiB performance spike is not part of normal tests.

## Prompt flow

- Default prompt behavior remains media-free.
- Author may opt in and choose placement (lesson/question/both), frequency and allowed kinds.
- AI output contains only canonical slots/descriptions; the author supplies local files in Tiqui.
