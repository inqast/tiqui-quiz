# Domain model and glossary

- **Template (Шаблон)** — editable text course source. User-facing copy avoids “Markdown”.
- **Course** — validated title/metadata and ordered Lessons.
- **Lesson / Topic** — ordered course section with Questions and at most one optional intro MediaSlot.
- **Question** — Choice, True/False, Input, Ordering or Matching task with at most one optional MediaSlot.
- **Explanation** — post-check feedback; never owns media.
- **MediaSlot** — source declaration with unique canonical ID, kind (`image`, `audio`, `video`) and mandatory description.
- **MediaAsset** — local Blob attached to one slot. Archive filename is strictly `<slotId>.<canonicalExt>`.
- **MediaRegistry** — in-memory ownership boundary for assets, sizes and preview URLs; replacement subtracts the old size before applying the 250 MiB total.
- **Editable Project** — `.tiqui` ZIP containing `project.json`, `lesson.md`, and `media/`; may preserve unresolved slots.
- **Student Package** — always a ZIP containing `index.html` plus optional `media/`; never contains the template or project manifest.
- **Progress / Attempt** — learner completion state and a checked answer; media playback is optional and independent from correctness.

Media formats: JPEG/PNG/WebP ≤15 MiB, MP3/M4A ≤50 MiB, MP4 (H.264/AAC) ≤250 MiB; all project media ≤250 MiB. Only local files are supported. v1 removes obvious source/manifest files from learner delivery but does not cryptographically hide or obfuscate answers.
