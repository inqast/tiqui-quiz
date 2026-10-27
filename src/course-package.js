const PACKAGE_MIB = 1024 * 1024;

const PACKAGE_DEFAULT_LIMITS = Object.freeze({
  image: 15 * PACKAGE_MIB,
  audio: 50 * PACKAGE_MIB,
  video: 250 * PACKAGE_MIB,
  total: 500 * PACKAGE_MIB,
  maxEntries: 1002,
  maxCompressionRatio: 100,
  metadataEntry: 2 * PACKAGE_MIB
});

const PACKAGE_MEDIA_FORMATS = Object.freeze({
  image: Object.freeze({
    'image/jpeg': Object.freeze(['jpg', 'jpeg']),
    'image/png': Object.freeze(['png']),
    'image/webp': Object.freeze(['webp'])
  }),
  audio: Object.freeze({
    'audio/mpeg': Object.freeze(['mp3']),
    'audio/mp4': Object.freeze(['m4a']),
    'audio/x-m4a': Object.freeze(['m4a'])
  }),
  video: Object.freeze({
    'video/mp4': Object.freeze(['mp4'])
  })
});

const packageEncoder = new TextEncoder();
const packageDecoder = new TextDecoder('utf-8', { fatal: true });

const packageOk = value => Object.freeze({ ok: true, value });
const packageFailure = (code, message) => Object.freeze({
  ok: false,
  errors: Object.freeze([Object.freeze({ code, message })])
});

function packageBytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function packageExtensionOf(filename) {
  return filename.match(/\.([^.]+)$/)?.[1]?.toLocaleLowerCase('en');
}

function packageIsSafeArchivePath(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/^[a-zA-Z]:\//.test(name) || name.startsWith('/') || name.startsWith('\\')) return false;
  if (/[\\\u0000-\u001f\u007f\u2044\u2215\u29f8\uff0f\ufe68\uff3c\u202a-\u202e\u2066-\u2069]/u.test(name)) return false;
  const parts = name.split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
}

function packageMediaFormatMatches(kind, mimeType, filename) {
  const extensions = PACKAGE_MEDIA_FORMATS[kind]?.[mimeType];
  return Boolean(extensions?.includes(packageExtensionOf(filename)));
}

function packageCanonicalFilename(item) {
  const canonicalExtension = PACKAGE_MEDIA_FORMATS[item.kind]?.[item.mimeType]?.[0];
  return canonicalExtension ? `${item.slotId}.${canonicalExtension}` : null;
}

function packageValidateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return packageFailure('invalid-manifest', 'Некорректный manifest проекта.');
  if (value.formatVersion !== 1) return packageFailure('unsupported-version', 'Версия проекта не поддерживается.');
  if (!Array.isArray(value.media)) return packageFailure('invalid-manifest', 'Некорректный список медиа проекта.');
  const slotIds = new Set();
  const filenames = new Set();
  for (const item of value.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return packageFailure('invalid-manifest', 'Некорректная запись медиа.');
    if (typeof item.slotId !== 'string' || !/^[a-zа-яё0-9]+(?:-[a-zа-яё0-9]+)*$/u.test(item.slotId) || item.slotId !== item.slotId.normalize('NFKC')) {
      return packageFailure('invalid-manifest', 'Некорректный идентификатор медиаслота.');
    }
    if (typeof item.filename !== 'string' || !packageIsSafeArchivePath(item.filename)) {
      return packageFailure('invalid-manifest', 'Некорректное имя медиафайла.');
    }
    if (typeof item.mimeType !== 'string' || !packageMediaFormatMatches(item.kind, item.mimeType, item.filename)) {
      return packageFailure('format-mismatch', 'MIME-тип, вид медиа и расширение не совпадают.');
    }
    if (item.filename !== packageCanonicalFilename(item)) {
      return packageFailure('invalid-manifest', 'Имя медиафайла не соответствует медиаслоту и формату.');
    }
    if (!Number.isSafeInteger(item.size) || item.size < 0 || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      return packageFailure('invalid-manifest', 'Некорректные сведения о медиафайле.');
    }
    if (slotIds.has(item.slotId) || filenames.has(item.filename.normalize('NFC'))) {
      return packageFailure('invalid-manifest', 'Manifest содержит повторяющееся медиа.');
    }
    slotIds.add(item.slotId);
    filenames.add(item.filename.normalize('NFC'));
  }
  return packageOk(value);
}

function packageArchiveError(error) {
  if (error?.name === 'AbortError') return packageFailure('aborted', 'Операция отменена.');
  return packageFailure('invalid-archive', 'Архив повреждён или не поддерживается.');
}

async function packageToBlob(entry) {
  if (entry.blob instanceof Blob) return entry.blob;
  if (entry.data instanceof Uint8Array) return new Blob([entry.data]);
  throw new TypeError('ZIP entry has no Blob data');
}

function packageCollectCourseSlotIds(course) {
  const slotIds = new Set();
  for (const lesson of course?.lessons || []) {
    if (lesson?.media?.id) slotIds.add(lesson.media.id);
    for (const question of lesson?.questions || []) {
      if (question?.media?.id) slotIds.add(question.media.id);
    }
  }
  return slotIds;
}

/** Adapt the bundled fflate streaming primitives to the CoursePackage ZIP port. */
function createFflateCourseZipAdapter(fflate) {
  if (typeof fflate?.Zip !== 'function' || typeof fflate?.ZipPassThrough !== 'function' || typeof fflate?.Unzip !== 'function') {
    throw new TypeError('CoursePackage requires an async ZIP adapter or fflate streaming API');
  }

  const create = (entries, options = {}) => new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const zip = new fflate.Zip((error, chunk, final) => {
      if (error) return fail(error);
      chunks.push(chunk);
      if (final && !settled) {
        settled = true;
        resolve(new Blob(chunks, { type: 'application/zip' }));
      }
    });

    (async () => {
      let completed = 0;
      for (const entry of entries) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const output = new fflate.ZipPassThrough(entry.name);
        zip.add(output);
        const reader = entry.blob.stream().getReader();
        try {
          while (true) {
            if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            output.push(value, false);
          }
          output.push(new Uint8Array(0), true);
        } finally {
          reader.releaseLock();
        }
        options.onProgress?.({ completed: ++completed, total: entries.length });
      }
      zip.end();
    })().catch(error => {
      try {
        zip.terminate();
      } finally {
        fail(error);
      }
    });
  });

  const open = async function* (archive, options = {}) {
    if (!(archive instanceof Blob)) throw new TypeError('Archive must be a Blob');
    const queue = [];
    let wake;
    let finished = false;
    let streamError;
    let entryCount = 0;
    let totalSize = 0;
    const normalizedPaths = new Set();
    const notify = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };
    const enqueueError = error => {
      if (!streamError) streamError = error;
      notify();
    };
    const limits = options.limits || {};
    const unzip = new fflate.Unzip(entry => {
      entryCount += 1;
      const normalized = entry.name.normalize('NFC');
      if (
        entryCount > (limits.maxEntries ?? Infinity) ||
        !packageIsSafeArchivePath(entry.name) ||
        normalizedPaths.has(normalized) ||
        entry.compression !== 0
      ) {
        entry.terminate();
        enqueueError(new Error('Unsafe or unsupported ZIP entry'));
        return;
      }
      normalizedPaths.add(normalized);
      const chunks = [];
      let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (error) {
          enqueueError(error);
          return;
        }
        size += chunk.byteLength;
        totalSize += chunk.byteLength;
        if (size > (limits.maxEntrySize ?? Infinity) || totalSize > (limits.maxTotalUncompressed ?? Infinity)) {
          entry.terminate();
          enqueueError(new Error('ZIP size limit exceeded'));
          return;
        }
        chunks.push(chunk);
        if (final) {
          queue.push({
            name: entry.name,
            blob: new Blob(chunks),
            compressedSize: size,
            uncompressedSize: size
          });
          options.onProgress?.({ completed: queue.length, total: undefined });
          notify();
        }
      };
      entry.start();
    });

    const feed = (async () => {
      const reader = archive.stream().getReader();
      try {
        while (true) {
          if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const { done, value } = await reader.read();
          if (done) break;
          unzip.push(value, false);
          if (streamError) throw streamError;
        }
        unzip.push(new Uint8Array(0), true);
        if (streamError) throw streamError;
      } finally {
        reader.releaseLock();
      }
    })().catch(error => {
      streamError = error;
    }).finally(() => {
      finished = true;
      notify();
    });

    try {
      while (!finished || queue.length) {
        if (streamError) throw streamError;
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        await new Promise(resolve => {
          wake = resolve;
        });
      }
      if (streamError) throw streamError;
      await feed;
    } finally {
      if (!finished) unzip.terminate();
    }
  };

  return Object.freeze({ create, open });
}

export function createCoursePackage(zipAdapter, options) {
  if (!zipAdapter || (typeof zipAdapter.create !== 'function' || typeof zipAdapter.open !== 'function')) {
    zipAdapter = createFflateCourseZipAdapter(zipAdapter);
  }
  if (!options || typeof options.digest !== 'function') throw new TypeError('CoursePackage requires a digest function');
  const digest = options.digest;
  const limits = Object.freeze({ ...PACKAGE_DEFAULT_LIMITS, ...options.limits });

  const digestBlob = async blob => packageBytesToHex(await digest('SHA-256', new Uint8Array(await blob.arrayBuffer())));

  const registryAssets = registry => {
    const manifestResult = registry?.exportManifest?.();
    if (!manifestResult?.ok) return packageFailure('invalid-registry', 'Не удалось прочитать реестр медиа.');
    const assets = [];
    for (const item of manifestResult.value) {
      const result = registry.get(item.slotId);
      if (!result?.ok || !result.value?.blob) return packageFailure('invalid-registry', 'Реестр медиа неполон.');
      assets.push(result.value);
    }
    return packageOk(assets);
  };

  const validateAssetsForExport = assets => {
    let total = 0;
    for (const asset of assets) {
      if (!packageMediaFormatMatches(asset.kind, asset.mimeType, asset.filename)) return packageFailure('format-mismatch', 'Формат медиафайла не поддерживается.');
      if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > limits[asset.kind]) return packageFailure('asset-size-limit', 'Медиафайл превышает допустимый размер.');
      total += asset.size;
      if (!Number.isSafeInteger(total) || total > limits.total) return packageFailure('project-size-limit', 'Медиа проекта превышают допустимый размер.');
    }
    return packageOk(total);
  };

  const saveProject = async ({ source, course: _course, registry }, opts = {}) => {
    try {
      if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
      if (typeof source !== 'string') return packageFailure('invalid-source', 'Исходный шаблон проекта отсутствует.');
      const assetsResult = registryAssets(registry);
      if (!assetsResult.ok) return assetsResult;
      const assets = assetsResult.value;
      const validation = validateAssetsForExport(assets);
      if (!validation.ok) return validation;
      const media = [];
      for (const asset of assets) {
        if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
        const sha256 = await digestBlob(asset.blob);
        if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
        media.push({
          slotId: asset.slotId,
          kind: asset.kind,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          sha256
        });
      }
      const manifest = JSON.stringify({ formatVersion: 1, media }, null, 2) + '\n';
      const entries = [
        { name: 'project.json', blob: new Blob([packageEncoder.encode(manifest)], { type: 'application/json' }) },
        { name: 'lesson.md', blob: new Blob([packageEncoder.encode(source)], { type: 'text/markdown' }) },
        ...assets.map(asset => ({ name: `media/${asset.filename}`, blob: asset.blob, store: true }))
      ];
      return packageOk(await zipAdapter.create(entries, opts));
    } catch (error) {
      return packageArchiveError(error);
    }
  };

  const exportStudentCourse = async ({ course, registry, indexHtml }, opts = {}) => {
    try {
      if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
      if (typeof indexHtml !== 'string') return packageFailure('invalid-runtime', 'HTML ученика отсутствует.');
      const registryValidation = registry?.validate?.(course);
      if (!registryValidation?.ok) return registryValidation || packageFailure('invalid-registry', 'Не удалось проверить реестр медиа.');
      const assetsResult = registryAssets(registry);
      if (!assetsResult.ok) return assetsResult;
      const referencedSlotIds = packageCollectCourseSlotIds(course);
      const referencedAssets = assetsResult.value.filter(asset => referencedSlotIds.has(asset.slotId));
      const validation = validateAssetsForExport(referencedAssets);
      if (!validation.ok) return validation;
      const entries = [
        { name: 'index.html', blob: new Blob([packageEncoder.encode(indexHtml)], { type: 'text/html' }) },
        ...referencedAssets.map(asset => ({ name: `media/${asset.filename}`, blob: asset.blob, store: true }))
      ];
      return packageOk(await zipAdapter.create(entries, opts));
    } catch (error) {
      return packageArchiveError(error);
    }
  };

  const openProject = async (file, opts = {}) => {
    if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
    const entries = new Map();
    const normalizedPaths = new Set();
    let uncompressedTotal = 0;
    try {
      const stream = zipAdapter.open(file, {
        ...opts,
        limits: {
          maxEntries: limits.maxEntries,
          maxEntrySize: Math.max(limits.video, limits.metadataEntry),
          maxTotalUncompressed: limits.total + 2 * limits.metadataEntry,
          maxCompressionRatio: limits.maxCompressionRatio
        }
      });
      for await (const entry of stream) {
        if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
        if (entries.size >= limits.maxEntries) return packageFailure('entry-count-limit', 'В архиве слишком много файлов.');
        if (!packageIsSafeArchivePath(entry.name)) return packageFailure('unsafe-path', 'Архив содержит небезопасный путь.');
        const normalized = entry.name.normalize('NFC');
        if (normalizedPaths.has(normalized)) return packageFailure('duplicate-path', 'Архив содержит повторяющийся путь.');
        normalizedPaths.add(normalized);
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) {
          return packageFailure('invalid-entry-size', 'Размер файла в архиве некорректен.');
        }
        const ratio = entry.uncompressedSize === 0 ? 1 : entry.uncompressedSize / Math.max(1, entry.compressedSize);
        if (ratio > limits.maxCompressionRatio) return packageFailure('compression-ratio-limit', 'Сжатие файла превышает безопасный предел.');
        const isMetadata = entry.name === 'project.json' || entry.name === 'lesson.md';
        const entryLimit = isMetadata ? limits.metadataEntry : Math.max(limits.image, limits.audio, limits.video);
        if (entry.uncompressedSize > entryLimit) return packageFailure('entry-size-limit', 'Файл в архиве превышает допустимый размер.');
        uncompressedTotal += entry.uncompressedSize;
        if (!Number.isSafeInteger(uncompressedTotal) || uncompressedTotal > limits.total + 2 * limits.metadataEntry) {
          return packageFailure('archive-size-limit', 'Распакованный архив превышает допустимый размер.');
        }
        const blob = await packageToBlob(entry);
        if (blob.size !== entry.uncompressedSize) return packageFailure('size-mismatch', 'Размер распакованного файла не совпадает с ZIP metadata.');
        entries.set(entry.name, { ...entry, blob });
      }
    } catch (error) {
      return packageArchiveError(error);
    }

    const projectEntry = entries.get('project.json');
    const sourceEntry = entries.get('lesson.md');
    if (!projectEntry || !sourceEntry) return packageFailure('invalid-manifest', 'В проекте отсутствуют обязательные файлы.');
    let manifest;
    let source;
    try {
      manifest = JSON.parse(packageDecoder.decode(await projectEntry.blob.arrayBuffer()));
      source = packageDecoder.decode(await sourceEntry.blob.arrayBuffer());
    } catch {
      return packageFailure('invalid-manifest', 'Manifest или шаблон проекта повреждён.');
    }
    const manifestResult = packageValidateManifest(manifest);
    if (!manifestResult.ok) return manifestResult;

    const expectedPaths = new Set(['project.json', 'lesson.md']);
    const assets = [];
    let mediaTotal = 0;
    for (const item of manifest.media) {
      const path = `media/${item.filename}`;
      expectedPaths.add(path);
      const entry = entries.get(path);
      if (!entry) return packageFailure('missing-media', 'Медиафайл из manifest отсутствует.');
      if (item.size !== entry.uncompressedSize || item.size !== entry.blob.size) return packageFailure('size-mismatch', 'Размер медиафайла не совпадает с manifest.');
      if (item.size > limits[item.kind]) return packageFailure('asset-size-limit', 'Медиафайл превышает допустимый размер.');
      mediaTotal += item.size;
      if (!Number.isSafeInteger(mediaTotal) || mediaTotal > limits.total) return packageFailure('project-size-limit', 'Медиа проекта превышают допустимый размер.');
      const sha256 = await digestBlob(entry.blob);
      if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
      if (sha256 !== item.sha256) return packageFailure('checksum-mismatch', 'Контрольная сумма медиафайла не совпадает.');
      assets.push(Object.freeze({
        slotId: item.slotId,
        kind: item.kind,
        filename: item.filename,
        mimeType: item.mimeType,
        size: item.size,
        blob: entry.blob.slice(0, entry.blob.size, item.mimeType)
      }));
    }
    for (const name of entries.keys()) {
      if (!expectedPaths.has(name)) {
        return packageFailure(name.startsWith('media/') ? 'orphan-media' : 'unsupported-entry', 'Архив содержит неподдерживаемый файл.');
      }
    }
    if (opts.signal?.aborted) return packageFailure('aborted', 'Операция отменена.');
    return packageOk(Object.freeze({
      source,
      assets: Object.freeze(assets),
      manifest: Object.freeze({ formatVersion: 1, media: Object.freeze(manifest.media.map(item => Object.freeze({ ...item }))) })
    }));
  };

  return Object.freeze({ openProject, saveProject, exportStudentCourse });
}
