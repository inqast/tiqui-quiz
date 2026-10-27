/** @typedef {'image' | 'audio' | 'video'} MediaKind */
/** @typedef {{ id: string, kind: MediaKind, description: string }} MediaSlot */
/** @typedef {Blob & { name: string }} LocalMediaFile */
/** @typedef {{ slotId: string, kind: MediaKind, filename: string, mimeType: string, size: number, blob: Blob }} MediaAsset */
/** @typedef {{ image?: number, audio?: number, video?: number, total?: number }} MediaLimits */
/** @typedef {{ createObjectURL?: (blob: Blob) => string, revokeObjectURL?: (url: string) => void, limits?: MediaLimits }} MediaRegistryOptions */
const MiB = 1024 * 1024;

const DEFAULT_LIMITS = Object.freeze({
  image: 15 * MiB,
  audio: 50 * MiB,
  video: 250 * MiB,
  total: 500 * MiB
});

/** @type {Readonly<Record<MediaKind, Readonly<Record<string, { extensions: readonly string[], canonicalExtension: string }>>>>} */
const FILE_POLICIES = Object.freeze({
  image: Object.freeze({
    'image/jpeg': Object.freeze({ extensions: Object.freeze(['jpg', 'jpeg']), canonicalExtension: 'jpg' }),
    'image/png': Object.freeze({ extensions: Object.freeze(['png']), canonicalExtension: 'png' }),
    'image/webp': Object.freeze({ extensions: Object.freeze(['webp']), canonicalExtension: 'webp' })
  }),
  audio: Object.freeze({
    'audio/mpeg': Object.freeze({ extensions: Object.freeze(['mp3']), canonicalExtension: 'mp3' }),
    'audio/mp4': Object.freeze({ extensions: Object.freeze(['m4a']), canonicalExtension: 'm4a' }),
    'audio/x-m4a': Object.freeze({ extensions: Object.freeze(['m4a']), canonicalExtension: 'm4a' })
  }),
  video: Object.freeze({
    'video/mp4': Object.freeze({ extensions: Object.freeze(['mp4']), canonicalExtension: 'mp4' })
  })
});

/** @template T @param {T} value */
const ok = value => ({ ok: true, value });
/** @param {ReadonlyArray<{ code: string, message: string, slotId?: string }>} errors */
const failure = errors => ({ ok: false, errors: Object.freeze(errors) });
/** @param {string} code @param {string} message @param {string | undefined} [slotId] */
const error = (code, message, slotId) => Object.freeze({ code, message, ...(slotId ? { slotId } : {}) });

/** @param {MediaAsset | undefined} asset */
function snapshot(asset) {
  if (!asset) return null;
  return Object.freeze({
    slotId: asset.slotId,
    kind: asset.kind,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    blob: asset.blob
  });
}

/** @param {{ lessons?: Array<{ media?: MediaSlot, questions?: Array<{ media?: MediaSlot }> }> } | undefined} course */
function collectSlots(course) {
  const slots = new Array();
  for (const lesson of course?.lessons || []) {
    if (lesson.media) slots.push(lesson.media);
    for (const question of lesson.questions || []) {
      if (question.media) slots.push(question.media);
    }
  }
  return slots;
}

/** @param {MediaRegistryOptions} [options] */
export function createMediaRegistry(options) {
  options ||= {};
  const limits = Object.freeze({
    image: options.limits?.image ?? DEFAULT_LIMITS.image,
    audio: options.limits?.audio ?? DEFAULT_LIMITS.audio,
    video: options.limits?.video ?? DEFAULT_LIMITS.video,
    total: options.limits?.total ?? DEFAULT_LIMITS.total
  });
  const createObjectURL = options.createObjectURL || (blob => URL.createObjectURL(blob));
  const revokeObjectURL = options.revokeObjectURL || (url => URL.revokeObjectURL(url));
  /** @type {Map<string, MediaAsset>} */
  const assets = new Map();
  /** @type {Map<string, string>} */
  const previewUrls = new Map();
  let totalSize = 0;

  /** @param {string} slotId */
  const revokePreviewUrl = slotId => {
    const url = previewUrls.get(slotId);
    if (!url) return ok(false);
    revokeObjectURL(url);
    previewUrls.delete(slotId);
    return ok(true);
  };

  /** @param {MediaSlot} slot @param {Blob} file */
  const attach = (slot, file) => {
    const slotId = slot?.id;
    if (typeof slotId !== 'string' || !/^[a-zа-яё0-9]+(?:-[a-zа-яё0-9]+)*$/i.test(slotId) || slotId.length > 60) {
      return failure([error('invalid-slot', 'Некорректный идентификатор медиаслота.', undefined)]);
    }
    if (!Object.prototype.hasOwnProperty.call(FILE_POLICIES, slot?.kind)) {
      return failure([error('invalid-kind', 'Неизвестный вид медиа.', slotId)]);
    }
    if (!(file instanceof Blob)) {
      return failure([error('invalid-file', 'Выберите локальный файл.', slotId)]);
    }
    const fileName = Reflect.get(file, 'name');
    if (typeof fileName !== 'string') {
      return failure([error('invalid-file', 'Выберите локальный файл.', slotId)]);
    }

    const mimeType = file.type.toLocaleLowerCase('en');
    const policy = FILE_POLICIES[slot.kind][mimeType];
    const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toLocaleLowerCase('en');
    if (!policy || !extension || !policy.extensions.includes(extension)) {
      return failure([error('unsupported-format', 'Тип файла и расширение не входят в список поддерживаемых.', slotId)]);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      return failure([error('invalid-size', 'Размер файла определить не удалось.', slotId)]);
    }
    if (file.size > limits[slot.kind]) {
      return failure([error('asset-size-limit', `Файл превышает лимит ${limits[slot.kind]} байт.`, slotId)]);
    }

    const previous = assets.get(slotId);
    const nextTotal = totalSize - (previous?.size || 0) + file.size;
    if (nextTotal > limits.total) {
      return failure([error('project-size-limit', `Медиа проекта превышают лимит ${limits.total} байт.`, slotId)]);
    }

    const asset = {
      slotId,
      kind: slot.kind,
      filename: `${slotId}.${policy.canonicalExtension}`,
      mimeType,
      size: file.size,
      blob: file
    };
    assets.set(slotId, asset);
    totalSize = nextTotal;
    if (previous) revokePreviewUrl(slotId);
    return ok(snapshot(asset));
  };

  /** @param {string} slotId */
  const remove = slotId => {
    const previous = assets.get(slotId);
    revokePreviewUrl(slotId);
    if (!previous) return ok(null);
    assets.delete(slotId);
    totalSize -= previous.size;
    return ok(snapshot(previous));
  };

  /** @param {string} slotId */
  const get = slotId => ok(snapshot(assets.get(slotId)));

  /** @param {{ lessons?: Array<{ media?: MediaSlot, questions?: Array<{ media?: MediaSlot }> }> }} course */
  const validate = course => {
    const errors = new Array();
    for (const mediaSlot of collectSlots(course)) {
      const asset = assets.get(mediaSlot.id);
      if (!asset) {
        errors.push(error('missing-asset', 'Для медиаслота не выбран файл.', mediaSlot.id));
      } else if (asset.kind !== mediaSlot.kind) {
        errors.push(error('kind-mismatch', 'Выбранный файл не соответствует виду медиаслота.', mediaSlot.id));
      }
    }
    return errors.length ? failure(errors) : ok(Object.freeze({ totalSize, assetCount: assets.size }));
  };

  const exportManifest = () => {
    const manifest = Array.from(assets.values(), asset => Object.freeze({
      slotId: asset.slotId,
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size
    })).sort((left, right) => left.slotId.localeCompare(right.slotId, 'ru'));
    return ok(Object.freeze(manifest));
  };

  /** @param {string} slotId */
  const createPreviewUrl = slotId => {
    const asset = assets.get(slotId);
    if (!asset) return failure([error('missing-asset', 'Для медиаслота не выбран файл.', slotId)]);
    if (!previewUrls.has(slotId)) previewUrls.set(slotId, createObjectURL(asset.blob));
    return ok(previewUrls.get(slotId));
  };

  const dispose = () => {
    for (const slotId of previewUrls.keys()) revokePreviewUrl(slotId);
    assets.clear();
    totalSize = 0;
    return ok(null);
  };

  return Object.freeze({
    attach,
    remove,
    get,
    validate,
    exportManifest,
    createPreviewUrl,
    revokePreviewUrl,
    dispose
  });
}
