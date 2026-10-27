# Development guide

## Setup and source ownership

- Use Node.js >=20.11, `npm ci`, and `make install-browser`.
- Edit ESM sources under `src/`; never hand-edit generated `quiz.html`.
- Media boundaries: parser/media-template grammar, MediaRegistry Blob ownership, CoursePackage ZIP/integrity, player rendering, app lifecycle.
- `fflate` is bundled explicitly for offline ZIP work. Preserve streaming ZIP paths and avoid synchronous whole-archive production helpers.

## Development loop

1. Read `CLAUDE.md` and Serena memories; use Serena for navigation/existing-file edits.
2. Add Node unit tests for pure registry/package/grammar behavior and Playwright tests for UI, offline `file://`, operation races and hostile content.
3. Run `make build` after source changes.
4. Run focused tests, then `make test`, `make audit`, and `make check-build`.
5. The 500 MiB spike runs only with `TIQUI_MEDIA_PERF=1 npm run test:media-performance`; never add it to the normal suite.
6. Inspect staged names/diff for secrets and generated/performance artifacts before commit.

## Quality and security

- Official automated browser target: repository-local Chromium desktop. Edge is a manual smoke target; do not claim it passed without executable/version evidence. Firefox, Safari and mobile are best effort.
- Test editable save/reopen, always-ZIP student export, extraction, offline `index.html`, zero external requests, and Lesson completion.
- Archive input must fail transactionally for traversal/backslashes/absolute paths, duplicates, unsupported/orphan entries, size/compression excess, malformed manifests, noncanonical filenames and checksum mismatch.
- Render descriptions and all template text inert; preserve accessible names/alt text.
- Supported limits are image 15 MiB, audio 50 MiB, video 250 MiB, total 500 MiB; >250 MiB asks for confirmation.
- There is no conventional formatter/typechecker/linter target; use existing style, tests, deterministic build, audit and CI security checks.
