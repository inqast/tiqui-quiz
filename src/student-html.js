import { createPlayer, PLAYER_CSS } from './player.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, character => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return '&quot;';
  });
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function normalizeMediaPaths(mediaPaths) {
  const entries = mediaPaths instanceof Map ? [...mediaPaths] : Object.entries(mediaPaths ?? {});
  const safe = {};
  for (const [slotId, path] of entries) {
    if (typeof slotId !== 'string' || typeof path !== 'string'
      || !/^media\/[^/\\?#:]+$/.test(path)
      || path.includes('..')) {
      throw new TypeError('Expected a safe relative media path');
    }
    safe[slotId] = path;
  }
  return safe;
}

export function createStudentHtml(course, mediaPaths) {
  const paths = normalizeMediaPaths(mediaPaths);
  const courseJson = serializeForScript(course);
  const pathsJson = serializeForScript(paths);
  const playerRuntime = createPlayer.toString();
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(course.title)}</title><style>html,body{margin:0;min-height:100%;background:#f7f7f2}${PLAYER_CSS}</style></head><body><main id="quiz"></main><script>const COURSE=${courseJson};const MEDIA_PATHS=${pathsJson};(${playerRuntime})(document.querySelector('#quiz'),COURSE,{resolveMedia:slot=>Object.prototype.hasOwnProperty.call(MEDIA_PATHS,slot.id)?MEDIA_PATHS[slot.id]:null});</script></body></html>`;
}
