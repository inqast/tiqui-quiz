# Architecture

## System purpose

- Local-first desktop browser application for authoring text templates, attaching local media, previewing learner behavior, and exporting offline courses.
- No backend, API, database, queue, analytics, or upload service. The optional AI workflow only generates a prompt for an external chat.
- Supported release target is current Chromium-based desktop browsers.

## Runtime modules

- `src/parser.js`: parses and validates the template plus Lesson/Question MediaSlot declarations.
- `src/media-template.js`: pure text operations for inserting/removing canonical media blocks.
- `src/media-registry.js`: owns local Blobs, canonical filenames, limits, preview object URLs, replacement accounting, and disposal.
- `src/course-package.js`: validates, hashes, streams, saves/opens editable `.tiqui` ZIPs and creates student ZIPs.
- `src/player.js`: renders optional Lesson intro media and Question media without changing answer logic.
- `src/app.js`: authoring orchestration, operation cancellation/commit gates, prompt options, media panel and downloads.
- `src/fflate.js`: explicitly bundled ZIP implementation; no runtime bare import.
- `scripts/build.js`: deterministic custom bundler that emits committed `quiz.html`.

## Package architecture

- Editable `.tiqui`: `project.json`, `lesson.md`, `media/<slotId>.<canonicalExt>`.
- Student delivery is always ZIP: `index.html` and optional `media/`; it excludes source template and manifest.
- Student `index.html` resolves only relative packaged media paths and runs from `file://` without network.
- ZIP input is fail-closed and transactional: safe normalized paths, entry/size/ratio limits, strict manifest, exact canonical filenames, SHA-256 integrity and no orphan entries.

## Invariants

- A Lesson and each Question may each own one optional MediaSlot; both levels may coexist. No media belongs to explanations.
- Descriptions are mandatory and learner-visible; image description is alt text.
- Per-kind limits: image 15 MiB, audio 50 MiB, video 250 MiB; project total 500 MiB. Heavy operations above 250 MiB require confirmation.
- Missing slot assets block student export but may remain in an editable project.
- Generated `quiz.html` is never edited manually; `make check-build` enforces determinism.
