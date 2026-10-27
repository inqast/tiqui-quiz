export class MediaTemplateError extends Error {
  code = 'MEDIA_TEMPLATE_ERROR';
  constructor(message, code = 'MEDIA_TEMPLATE_ERROR') {
    super(message);
    this.name = 'MediaTemplateError';
    this.code = code;
  }
}

const MEDIA_FIELD = /^\s*(Медиа|Описание медиа):/i;
const LESSON_METADATA = /^\s*(Иконка|Описание|ID):/i;

function sourceLines(source) {
  return String(source).replace(/\r\n?/g, '\n').split('\n');
}

function validateAnchor(lines, anchor) {
  const expected = anchor?.scope === 'lesson' ? /^##\s+/ : anchor?.scope === 'question' ? /^###\s+/ : null;
  const actualHeading = lines[anchor?.line]?.trim() ?? '';
  if (
    !expected
    || !Number.isInteger(anchor.line)
    || typeof anchor.heading !== 'string'
    || !expected.test(anchor.heading)
    || actualHeading !== anchor.heading
  ) {
    throw new MediaTemplateError('Источник изменился: позиция темы или вопроса устарела', 'STALE_ANCHOR');
  }
}

function ownerEnd(lines, anchor) {
  const nextHeading = /^#{1,3}\s+/;
  for (let index = anchor.line + 1; index < lines.length; index++) {
    if (nextHeading.test(lines[index].trim())) return index;
  }
  return lines.length;
}

function withoutMediaFields(lines, anchor) {
  const end = ownerEnd(lines, anchor);
  return lines.filter((line, index) => index <= anchor.line || index >= end || !MEDIA_FIELD.test(line));
}

export function upsertMediaBlock(source, anchor, media) {
  const lines = sourceLines(source);
  validateAnchor(lines, anchor);
  const updated = withoutMediaFields(lines, anchor);
  let insertAt = anchor.line + 1;
  if (anchor.scope === 'lesson') {
    const end = ownerEnd(updated, anchor);
    for (let index = anchor.line + 1; index < end; index++) {
      if (LESSON_METADATA.test(updated[index])) insertAt = index + 1;
    }
  }
  updated.splice(insertAt, 0, `Медиа: ${media.kind}:${media.id}`, `Описание медиа: ${media.description}`);
  return updated.join('\n');
}

export function removeMediaBlock(source, anchor) {
  const lines = sourceLines(source);
  validateAnchor(lines, anchor);
  return withoutMediaFields(lines, anchor).join('\n');
}
