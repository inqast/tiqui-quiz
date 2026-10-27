import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as fflate from 'fflate';
import { createCoursePackage } from '../../src/course-package.js';
import { createMediaRegistry } from '../../src/media-registry.js';
import { parseDocument } from '../../src/parser.js';

const digest = async (_, bytes) => createHash('sha256').update(bytes).digest();
const source = '# Course\nОписание: About\n\n## Lesson\n\n### Выбор\nQuestion?\n- [x] Yes\n- [ ] No\n';
const course = parseDocument(source).course;
const api = options => createCoursePackage(fflate, { digest, ...options });
const registryWith = count => {
  const registry = createMediaRegistry();
  for (let i = 0; i < count; i++) registry.attach({ id: `asset-${i}`, kind: 'image', description: 'Picture' }, new File(['png'], 'a.png', { type: 'image/png' }));
  return registry;
};

test('editable source has the same exact UTF-8 metadata boundary on save and reopen', async () => {
  const packageApi = api(), registry = registryWith(0);
  const exact = source + 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(source));
  const saved = await packageApi.saveProject({ source: exact, course, registry });
  assert.equal(saved.ok, true);
  assert.equal((await packageApi.openProject(saved.value)).ok, true);
  for (const extra of ['x', 'я']) {
    const rejected = await packageApi.saveProject({ source: exact + extra, course, registry });
    assert.equal(rejected.ok, false, 'oversized source must be rejected before emitting an unreopenable project');
    assert.equal('value' in rejected, false);
  }
});

test('student runtime enforces the exact UTF-8 metadata boundary before producing a ZIP', async () => {
  const packageApi = api(), registry = registryWith(0);
  const indexHtml = 'x'.repeat(2 * 1024 * 1024);
  assert.equal((await packageApi.exportStudentCourse({ course, registry, indexHtml })).ok, true);
  const rejected = await packageApi.exportStudentCourse({ course, registry, indexHtml: indexHtml + 'я' });
  assert.equal(rejected.ok, false);
  assert.equal('value' in rejected, false);
});

test('editable manifest has the same exact metadata boundary on save and reopen', async () => {
  const registry = registryWith(1);
  const manifest = JSON.stringify({ formatVersion: 1, media: [{ slotId: 'asset-0', kind: 'image', filename: 'asset-0.png', mimeType: 'image/png', size: 3, sha256: createHash('sha256').update('png').digest('hex') }] }, null, 2) + '\n';
  const packageApi = api({ limits: { metadataEntry: Buffer.byteLength(manifest) } });
  const saved = await packageApi.saveProject({ source, course, registry });
  assert.equal(saved.ok, true);
  assert.equal((await packageApi.openProject(saved.value)).ok, true);
  assert.equal((await api({ limits: { metadataEntry: Buffer.byteLength(manifest) - 1 } }).saveProject({ source, course, registry })).ok, false);
});

test('save and student export share the 1000 asset boundary with editable import', async () => {
  const packageApi = api(), registry = registryWith(1000);
  const mediaCourse = { lessons: [{ questions: Array.from({ length: 1001 }, (_, i) => ({ media: { id: `asset-${i}`, kind: 'image' } })) }] };
  const saved = await packageApi.saveProject({ source, course, registry });
  assert.equal(saved.ok, true);
  assert.equal((await packageApi.openProject(saved.value)).ok, true);
  const exactCourse = { lessons: [{ questions: mediaCourse.lessons[0].questions.slice(0, 1000) }] };
  assert.equal((await packageApi.exportStudentCourse({ course: exactCourse, registry, indexHtml: '<html></html>' })).ok, true);
  registry.attach({ id: 'asset-1000', kind: 'image' }, new File(['png'], 'a.png', { type: 'image/png' }));
  assert.equal((await packageApi.saveProject({ source, course, registry })).ok, false);
  assert.equal((await packageApi.exportStudentCourse({ course: mediaCourse, registry, indexHtml: '<html></html>' })).ok, false);
});

test('production ZIP adapter rejects byte corruption and incomplete central directory transactionally', async t => {
  const packageApi = api();
  const saved = await packageApi.saveProject({ source, course, registry: registryWith(1) });
  const bytes = Buffer.from(await saved.value.arrayBuffer());
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const payloadOffset = name => {
    const nameOffset = bytes.indexOf(Buffer.from(name));
    const local = nameOffset - 30;
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    return nameOffset + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  };
  const lesson = payloadOffset('lesson.md');
  const media = payloadOffset('media/asset-0.png');
  assert.ok(central > 0 && lesson > 0 && media > 0);
  const cases = [
    ['lesson CRC', copy => { copy[lesson + 2] ^= 1; return copy; }],
    ['manifest CRC', copy => { copy[payloadOffset('project.json') + 1] = 32; return copy; }],
    ['media CRC', copy => { copy[media] ^= 1; return copy; }],
    ['EOCD removed', copy => copy.subarray(0, copy.length - 22)],
    ['central directory truncated', copy => copy.subarray(0, central + 8)],
    ['central directory CRC differs', copy => { copy[central + 16] ^= 1; return copy; }],
  ];
  for (const [name, corrupt] of cases) await t.test(name, async () => {
    const result = await packageApi.openProject(new Blob([corrupt(Buffer.from(bytes))]));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'invalid-archive', 'reject at ZIP integrity boundary before interpreting payload');
    assert.equal('value' in result, false, 'never expose a partial candidate');
  });
});

test('early metadata rejection closes the real streaming reader without replacing the validation error', async () => {
  const bytes = fflate.zipSync({ 'project.json': fflate.strToU8('{"formatVersion":1,"media":[]}'), 'lesson.md': fflate.strToU8(source + 'x'.repeat(100)), 'media/extra.png': new Uint8Array(2 * 1024 * 1024) }, { level: 0 });
  const result = await api({ limits: { metadataEntry: 64 } }).openProject(new Blob([bytes]));
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'entry-size-limit');
});

test('Windows device stems are rejected consistently after canonicalization', async t => {
  const reserved = ['con', 'prn', 'aux', 'nul', 'clock$', ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)];
  for (const id of reserved) await t.test(id, async () => {
    for (const variant of [id, id.toUpperCase(), ` ${id} `, [...id.toUpperCase()].map(char => String.fromCharCode(char.charCodeAt(0) + 0xfee0)).join('')]) {
      const parsed = parseDocument(source.replace('## Lesson', `## Lesson\nМедиа: image:${variant}\nОписание медиа: Picture`));
      assert.ok(parsed.errors.length > 0, `parser accepted ${variant}`);
    }
    assert.equal(createMediaRegistry().attach({ id, kind: 'image' }, new File(['png'], 'a.png', { type: 'image/png' })).ok, false);
    const manifest = { formatVersion: 1, media: [{ slotId: id, filename: `${id}.png`, kind: 'image', mimeType: 'image/png', size: 3, sha256: createHash('sha256').update('png').digest('hex') }] };
    const archive = fflate.zipSync({ 'project.json': fflate.strToU8(JSON.stringify(manifest)), 'lesson.md': fflate.strToU8(source), [`media/${id}.png`]: fflate.strToU8('png') }, { level: 0 });
    assert.equal((await api().openProject(new Blob([archive]))).ok, false);
  });
  for (const id of ['con-photo', 'com10', 'lpt10', 'normal', 'clock', 'картинка']) {
    assert.equal(createMediaRegistry().attach({ id, kind: 'image' }, new File(['png'], 'a.png', { type: 'image/png' })).ok, true);
  }
});
