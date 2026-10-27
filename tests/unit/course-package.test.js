import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as fflate from 'fflate';

import { createCoursePackage } from '../../src/course-package.js';
import { createMediaRegistry } from '../../src/media-registry.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class LocalFile extends Blob {
  constructor(parts, name, options) {
    super(parts, options);
    this.name = name;
  }
}

function digest(_algorithm, bytes) {
  return Promise.resolve(createHash('sha256').update(bytes).digest().buffer);
}

function createMemoryZipAdapter() {
  const archives = new WeakMap();
  return {
    async create(entries, options = {}) {
      const normalized = [];
      let completed = 0;
      for (const entry of entries) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const data = new Uint8Array(await entry.blob.arrayBuffer());
        normalized.push({
          name: entry.name,
          data,
          compressedSize: entry.store ? data.byteLength : Math.max(1, Math.ceil(data.byteLength / 2)),
          uncompressedSize: data.byteLength
        });
        options.onProgress?.({ completed: ++completed, total: entries.length });
      }
      const archive = new Blob([encoder.encode('memory-zip')], { type: 'application/zip' });
      archives.set(archive, normalized);
      return archive;
    },
    async *open(archive, options = {}) {
      const entries = archives.get(archive);
      if (!entries) throw new Error('corrupt ZIP');
      let completed = 0;
      for (const entry of entries) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        options.onProgress?.({ completed: ++completed, total: entries.length });
        yield { ...entry, blob: new Blob([entry.data]) };
      }
    },
    hostile(entries) {
      const archive = new Blob([encoder.encode('hostile')], { type: 'application/zip' });
      archives.set(archive, entries.map(entry => {
        const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data || '');
        return {
          name: entry.name,
          data,
          blob: new Blob([data]),
          compressedSize: entry.compressedSize ?? Math.max(1, data.byteLength),
          uncompressedSize: entry.uncompressedSize ?? data.byteLength
        };
      }));
      return archive;
    },
    async inspect(archive) {
      return (archives.get(archive) || []).map(entry => ({ ...entry }));
    }
  };
}

function slot(id, kind, description = 'Описание') {
  return { id, kind, description };
}

function file(name, type, content) {
  return new LocalFile([content], name, { type });
}

function courseWithMedia(media) {
  return { lessons: [{ id: 'lesson', title: 'Тема', media, questions: [] }] };
}

function projectManifest(media = []) {
  return JSON.stringify({ formatVersion: 1, media });
}

function manifestEntry(name, text) {
  const data = encoder.encode(text);
  return { name, data, blob: new Blob([data]), compressedSize: data.length, uncompressedSize: data.length };
}

test('saves and reopens a deterministic editable project with verified media', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const registry = createMediaRegistry();
  const intro = slot('intro', 'image');
  registry.attach(intro, file('photo.png', 'image/png', 'PNG bytes'));

  const saved = await packageApi.saveProject({
    source: '# Курс\n\n## Тема\n\nМедиа: image | intro | Описание',
    course: courseWithMedia(intro),
    registry
  });

  assert.equal(saved.ok, true);
  const entries = await zipAdapter.inspect(saved.value);
  assert.deepEqual(entries.map(entry => entry.name), ['project.json', 'lesson.md', 'media/intro.png']);
  const manifest = JSON.parse(decoder.decode(entries[0].data));
  assert.deepEqual(manifest, {
    formatVersion: 1,
    media: [{
      slotId: 'intro',
      kind: 'image',
      filename: 'intro.png',
      mimeType: 'image/png',
      size: 9,
      sha256: createHash('sha256').update('PNG bytes').digest('hex')
    }]
  });
  assert.equal(entries[2].compressedSize, entries[2].uncompressedSize, 'media must be stored without recompression');

  const opened = await packageApi.openProject(saved.value);
  assert.equal(opened.ok, true);
  assert.equal(opened.value.source, '# Курс\n\n## Тема\n\nМедиа: image | intro | Описание');
  assert.deepEqual(opened.value.manifest, manifest);
  assert.equal(opened.value.assets.length, 1);
  assert.equal(opened.value.assets[0].slotId, 'intro');
  assert.equal(opened.value.assets[0].blob.type, 'image/png');
  assert.equal(await opened.value.assets[0].blob.text(), 'PNG bytes');
});

test('adapts the bundled fflate streaming API without synchronous whole-archive helpers', async () => {
  const packageApi = createCoursePackage(fflate, { digest });
  const registry = createMediaRegistry();
  const intro = slot('intro', 'image');
  registry.attach(intro, file('photo.png', 'image/png', 'PNG bytes'));

  const saved = await packageApi.saveProject({ source: '# Course', course: courseWithMedia(intro), registry });
  assert.equal(saved.ok, true);
  assert.equal(saved.value instanceof Blob, true);
  const opened = await packageApi.openProject(saved.value);
  assert.equal(opened.ok, true);
  assert.equal(opened.value.source, '# Course');
  assert.equal(await opened.value.assets[0].blob.text(), 'PNG bytes');
});

test('preserves unresolved slots in source without inventing media entries', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const source = '# Курс\n\nМедиа: audio | missing | Описание';
  const saved = await packageApi.saveProject({ source, course: courseWithMedia(slot('missing', 'audio')), registry: createMediaRegistry() });

  assert.equal(saved.ok, true);
  const entries = await zipAdapter.inspect(saved.value);
  assert.deepEqual(entries.map(entry => entry.name), ['project.json', 'lesson.md']);
  assert.deepEqual(JSON.parse(decoder.decode(entries[0].data)).media, []);
  assert.equal((await packageApi.openProject(saved.value)).value.source, source);
});

test('always exports a student ZIP and includes only runtime files', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const emptyRegistry = createMediaRegistry();
  const withoutMedia = await packageApi.exportStudentCourse({ course: { lessons: [] }, registry: emptyRegistry, indexHtml: '<!doctype html><title>Квиз</title>' });

  assert.equal(withoutMedia.ok, true);
  assert.deepEqual((await zipAdapter.inspect(withoutMedia.value)).map(entry => entry.name), ['index.html']);

  const registry = createMediaRegistry();
  const media = slot('voice', 'audio');
  registry.attach(media, file('voice.mp3', 'audio/mpeg', 'audio'));
  const withMedia = await packageApi.exportStudentCourse({ course: courseWithMedia(media), registry, indexHtml: '<!doctype html>' });
  const names = (await zipAdapter.inspect(withMedia.value)).map(entry => entry.name);
  assert.deepEqual(names, ['index.html', 'media/voice.mp3']);
  assert.equal(names.some(name => ['lesson.md', 'project.json', 'answers.json'].includes(name)), false);
});

test('refuses student export while a declared media slot is unresolved', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const result = await packageApi.exportStudentCourse({
    course: courseWithMedia(slot('missing', 'video')),
    registry: createMediaRegistry(),
    indexHtml: '<!doctype html>'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'missing-asset');
});

test('student export excludes stale registry assets not referenced by the current course', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const registry = createMediaRegistry();
  const current = slot('current', 'image');
  registry.attach(current, file('current.png', 'image/png', 'current'));
  registry.attach(slot('stale', 'audio'), file('stale.mp3', 'audio/mpeg', 'stale'));

  const result = await packageApi.exportStudentCourse({
    course: courseWithMedia(current),
    registry,
    indexHtml: '<!doctype html>'
  });

  assert.equal(result.ok, true);
  assert.deepEqual((await zipAdapter.inspect(result.value)).map(entry => entry.name), [
    'index.html',
    'media/current.png'
  ]);
});

test('rejects unsafe and duplicate normalized archive paths transactionally', async t => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const safe = [manifestEntry('project.json', projectManifest()), manifestEntry('lesson.md', '# Course')];
  const cases = [
    ['traversal', [...safe, manifestEntry('../media/x.png', 'x')], 'unsafe-path'],
    ['absolute POSIX', [...safe, manifestEntry('/media/x.png', 'x')], 'unsafe-path'],
    ['absolute drive', [...safe, manifestEntry('C:/media/x.png', 'x')], 'unsafe-path'],
    ['backslash', [...safe, manifestEntry('media\\x.png', 'x')], 'unsafe-path'],
    ['confusable slash', [...safe, manifestEntry('media\u2215x.png', 'x')], 'unsafe-path'],
    ['duplicate normalized Unicode', [...safe, manifestEntry('media/caf\u00e9.png', 'x'), manifestEntry('media/cafe\u0301.png', 'x')], 'duplicate-path']
  ];
  for (const [name, entries, code] of cases) {
    await t.test(name, async () => {
      const result = await packageApi.openProject(zipAdapter.hostile(entries));
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, code);
      assert.equal('value' in result, false, 'failed imports must not expose a partial candidate');
    });
  }
});

test('rejects malformed manifests, unsupported entries and media integrity failures', async t => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest, limits: { maxEntries: 3 } });
  const png = encoder.encode('PNG bytes');
  const checksum = createHash('sha256').update(png).digest('hex');
  const asset = { slotId: 'intro', kind: 'image', filename: 'intro.png', mimeType: 'image/png', size: png.length, sha256: checksum };
  const archive = (manifest, media = [{ name: 'media/intro.png', data: png }], extras = []) => zipAdapter.hostile([
    manifestEntry('project.json', typeof manifest === 'string' ? manifest : JSON.stringify(manifest)),
    manifestEntry('lesson.md', '# Course'),
    ...media,
    ...extras
  ]);
  const cases = [
    ['invalid JSON', archive('{'), 'invalid-manifest'],
    ['unsupported version', archive({ formatVersion: 2, media: [] }, []), 'unsupported-version'],
    ['unsupported root entry', archive({ formatVersion: 1, media: [] }, [], [manifestEntry('answers.json', '{}')]), 'unsupported-entry'],
    ['missing media', archive({ formatVersion: 1, media: [asset] }, []), 'missing-media'],
    ['orphan media', archive({ formatVersion: 1, media: [] }), 'orphan-media'],
    ['size mismatch', archive({ formatVersion: 1, media: [{ ...asset, size: png.length + 1 }] }), 'size-mismatch'],
    ['checksum mismatch', archive({ formatVersion: 1, media: [{ ...asset, sha256: '0'.repeat(64) }] }), 'checksum-mismatch'],
    ['MIME extension mismatch', archive({ formatVersion: 1, media: [{ ...asset, mimeType: 'audio/mpeg' }] }), 'format-mismatch'],
    ['filename not derived from slot', archive({ formatVersion: 1, media: [{ ...asset, filename: 'other.png' }] }, [{ name: 'media/other.png', data: png }]), 'invalid-manifest'],
    ['non-canonical extension spelling', archive({ formatVersion: 1, media: [{ ...asset, filename: 'intro.PNG' }] }, [{ name: 'media/intro.PNG', data: png }]), 'invalid-manifest'],
    ['too many entries', archive({ formatVersion: 1, media: [] }, [], [manifestEntry('x', ''), manifestEntry('y', '')]), 'entry-count-limit']
  ];
  for (const [name, input, code] of cases) {
    await t.test(name, async () => {
      const result = await packageApi.openProject(input);
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, code);
      assert.equal('value' in result, false);
    });
  }
});

test('rejects per-kind, total-size and compression-ratio excess before accepting a candidate', async t => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, {
    digest,
    limits: { image: 8, audio: 10, video: 12, total: 16, maxCompressionRatio: 4 }
  });
  const bytes = encoder.encode('123456789');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const media = { slotId: 'asset', kind: 'image', filename: 'asset.png', mimeType: 'image/png', size: bytes.length, sha256 };
  const make = (entry, manifestMedia = media) => zipAdapter.hostile([
    manifestEntry('project.json', projectManifest([manifestMedia])),
    manifestEntry('lesson.md', '# Course'),
    entry
  ]);
  const cases = [
    ['per-kind size', make({ name: 'media/asset.png', data: bytes }), 'asset-size-limit'],
    ['compression ratio', make({ name: 'media/asset.png', data: bytes.subarray(0, 8), uncompressedSize: 8, compressedSize: 1 }, { ...media, size: 8, sha256: createHash('sha256').update(bytes.subarray(0, 8)).digest('hex') }), 'compression-ratio-limit'],
    ['declared versus uncompressed size', make({ name: 'media/asset.png', data: bytes.subarray(0, 8), uncompressedSize: 7, compressedSize: 7 }, { ...media, size: 8, sha256: createHash('sha256').update(bytes.subarray(0, 8)).digest('hex') }), 'size-mismatch']
  ];
  for (const [name, input, code] of cases) {
    await t.test(name, async () => {
      const result = await packageApi.openProject(input);
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, code);
    });
  }
});

test('rejects a manifest whose media total exceeds the project limit', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest, limits: { image: 10, total: 16 } });
  const first = encoder.encode('12345678');
  const second = encoder.encode('123456789');
  const item = (slotId, filename, bytes) => ({
    slotId,
    kind: 'image',
    filename,
    mimeType: 'image/png',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
  const input = zipAdapter.hostile([
    manifestEntry('project.json', projectManifest([item('one', 'one.png', first), item('two', 'two.png', second)])),
    manifestEntry('lesson.md', '# Course'),
    { name: 'media/one.png', data: first },
    { name: 'media/two.png', data: second }
  ]);

  const result = await packageApi.openProject(input);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'project-size-limit');
  assert.equal('value' in result, false);
});

test('reports abort and corrupt ZIP without returning partial project data', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const packageApi = createCoursePackage(zipAdapter, { digest });
  const controller = new AbortController();
  controller.abort();

  const aborted = await packageApi.openProject(zipAdapter.hostile([manifestEntry('project.json', projectManifest())]), { signal: controller.signal });
  assert.equal(aborted.ok, false);
  assert.equal(aborted.errors[0].code, 'aborted');
  assert.equal('value' in aborted, false);

  const corrupt = await packageApi.openProject(new Blob(['not an archive']));
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.errors[0].code, 'invalid-archive');
  assert.equal('value' in corrupt, false);
});

test('honors cancellation that arrives while hashing media', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const controller = new AbortController();
  const delayedDigest = async (...args) => {
    controller.abort();
    return digest(...args);
  };
  const packageApi = createCoursePackage(zipAdapter, { digest: delayedDigest });
  const registry = createMediaRegistry();
  const intro = slot('intro', 'image');
  registry.attach(intro, file('photo.png', 'image/png', 'PNG bytes'));

  const result = await packageApi.saveProject({ source: '# Course', course: courseWithMedia(intro), registry }, { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'aborted');
});

test('openProject fails closed when cancellation arrives during the final media digest', async () => {
  const zipAdapter = createMemoryZipAdapter();
  const registry = createMediaRegistry();
  const intro = slot('intro', 'image');
  registry.attach(intro, file('photo.png', 'image/png', 'PNG bytes'));
  const saved = await createCoursePackage(zipAdapter, { digest }).saveProject({
    source: '# Course',
    course: courseWithMedia(intro),
    registry
  });
  assert.equal(saved.ok, true);

  const controller = new AbortController();
  const abortingDigest = async (...args) => {
    const result = await digest(...args);
    controller.abort();
    return result;
  };
  const opened = await createCoursePackage(zipAdapter, { digest: abortingDigest }).openProject(
    saved.value,
    { signal: controller.signal }
  );

  assert.equal(opened.ok, false);
  assert.equal(opened.errors[0].code, 'aborted');
  assert.equal('value' in opened, false);
});
