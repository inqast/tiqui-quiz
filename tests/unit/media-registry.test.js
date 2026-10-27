import assert from 'node:assert/strict';
import test from 'node:test';

import { createMediaRegistry } from '../../src/media-registry.js';

const MiB = 1024 * 1024;

class SizedFile extends Blob {
  constructor(name, type, size) {
    super([], { type });
    this.name = name;
    this.declaredSize = size;
  }

  get size() {
    return this.declaredSize;
  }
}

const slot = (id, kind) => ({ id, kind, description: `Описание ${id}` });
const file = (name, type, size = 1) => new SizedFile(name, type, size);

test('accepts only allowlisted MIME and extension pairs and normalizes archive names', () => {
  const registry = createMediaRegistry();
  const cases = [
    [slot('фото', 'image'), file('LOCAL.JPEG', 'image/jpeg'), 'фото.jpg'],
    [slot('схема', 'image'), file('schema.png', 'image/png'), 'схема.png'],
    [slot('обложка', 'image'), file('cover.webp', 'image/webp'), 'обложка.webp'],
    [slot('речь', 'audio'), file('voice.mp3', 'audio/mpeg'), 'речь.mp3'],
    [slot('лекция', 'audio'), file('lecture.m4a', 'audio/mp4'), 'лекция.m4a'],
    [slot('введение', 'video'), file('intro.mp4', 'video/mp4'), 'введение.mp4']
  ];

  for (const [mediaSlot, localFile, expectedFilename] of cases) {
    const result = registry.attach(mediaSlot, localFile);
    assert.equal(result.ok, true);
    assert.equal(result.value.filename, expectedFilename);
  }

  assert.equal(registry.attach(slot('svg', 'image'), file('active.svg', 'image/svg+xml')).ok, false);
  assert.equal(registry.attach(slot('маскировка', 'image'), file('fake.png', 'image/jpeg')).ok, false);
  assert.equal(registry.attach(slot('чужой-тип', 'image'), file('clip.mp4', 'video/mp4')).ok, false);
});

test('accepts exact canonical slot IDs and rejects uppercase or non-NFKC variants', () => {
  const accepted = createMediaRegistry();
  assert.equal(accepted.attach(slot('abc-123', 'image'), file('latin.png', 'image/png')).ok, true);
  assert.equal(accepted.attach(slot('фото-ёж-2', 'image'), file('cyrillic.png', 'image/png')).ok, true);

  const rejected = ['ABC', 'Фото', 'и\u0306'];
  for (const id of rejected) {
    const result = createMediaRegistry().attach(slot(id, 'image'), file('photo.png', 'image/png'));
    assert.equal(result.ok, false, `expected ${JSON.stringify(id)} to be rejected`);
    assert.equal(result.errors[0].code, 'invalid-slot');
  }
});

test('enforces 15/50/250 MiB per-kind limits and the 500 MiB project total', () => {
  const registry = createMediaRegistry();

  assert.equal(registry.attach(slot('image-ok', 'image'), file('ok.png', 'image/png', 15 * MiB)).ok, true);
  assert.equal(registry.attach(slot('image-big', 'image'), file('big.png', 'image/png', 15 * MiB + 1)).ok, false);
  assert.equal(registry.attach(slot('audio-ok', 'audio'), file('ok.mp3', 'audio/mpeg', 50 * MiB)).ok, true);
  assert.equal(registry.attach(slot('audio-big', 'audio'), file('big.mp3', 'audio/mpeg', 50 * MiB + 1)).ok, false);
  assert.equal(registry.attach(slot('video-a', 'video'), file('a.mp4', 'video/mp4', 250 * MiB)).ok, true);
  assert.equal(registry.attach(slot('video-b', 'video'), file('b.mp4', 'video/mp4', 185 * MiB)).ok, true);
  const totalOverflow = registry.attach(slot('overflow', 'image'), file('overflow.png', 'image/png', 1));
  assert.equal(totalOverflow.ok, false);
  assert.equal(totalOverflow.errors[0].code, 'project-size-limit');
});

test('replaces atomically, preserves the old asset after rejection, and revokes its URL only on success', () => {
  const revoked = [];
  const registry = createMediaRegistry({
    createObjectURL: blob => `blob:${blob.name}`,
    revokeObjectURL: url => revoked.push(url)
  });
  const mediaSlot = slot('intro', 'video');
  const original = file('old.mp4', 'video/mp4', 10);

  registry.attach(mediaSlot, original);
  assert.equal(registry.createPreviewUrl('intro').value, 'blob:old.mp4');
  assert.equal(registry.attach(mediaSlot, file('too-big.mp4', 'video/mp4', 250 * MiB + 1)).ok, false);
  assert.equal(registry.get('intro').value.blob, original);
  assert.deepEqual(revoked, []);

  const replacement = file('new.mp4', 'video/mp4', 20);
  assert.equal(registry.attach(mediaSlot, replacement).ok, true);
  assert.equal(registry.get('intro').value.blob, replacement);
  assert.deepEqual(revoked, ['blob:old.mp4']);
});


test('accounts for replacement size instead of double-counting near the 500 MiB limit', () => {
  const registry = createMediaRegistry();
  assert.equal(registry.attach(slot('first', 'video'), file('first.mp4', 'video/mp4', 250 * MiB)).ok, true);
  assert.equal(registry.attach(slot('second', 'video'), file('second.mp4', 'video/mp4', 250 * MiB)).ok, true);

  const replacement = file('replacement.mp4', 'video/mp4', 250 * MiB);
  assert.equal(registry.attach(slot('first', 'video'), replacement).ok, true);
  assert.equal(registry.get('first').value.blob, replacement);
  assert.equal(registry.validate({ lessons: [{ media: slot('first', 'video'), questions: [{ media: slot('second', 'video') }] }] }).value.totalSize, 500 * MiB);
});

test('returns frozen snapshots and a deterministic manifest without exposing registry mutation', () => {
  const registry = createMediaRegistry();
  registry.attach(slot('z-slot', 'image'), file('z.png', 'image/png', 3));
  registry.attach(slot('a-slot', 'audio'), file('a.mp3', 'audio/mpeg', 2));

  const asset = registry.get('a-slot').value;
  assert.equal(Object.isFrozen(asset), true);
  assert.throws(() => { asset.filename = 'changed'; }, TypeError);
  assert.deepEqual(registry.exportManifest().value.map(item => item.slotId), ['a-slot', 'z-slot']);
  assert.equal(Object.isFrozen(registry.exportManifest().value), true);
});

test('validates every lesson and question slot and reports missing assets', () => {
  const registry = createMediaRegistry();
  registry.attach(slot('lesson-intro', 'video'), file('intro.mp4', 'video/mp4'));
  const course = {
    lessons: [{
      media: slot('lesson-intro', 'video'),
      questions: [{ media: slot('question-photo', 'image') }, {}]
    }]
  };

  const invalid = registry.validate(course);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors.map(error => error.slotId), ['question-photo']);

  registry.attach(slot('question-photo', 'image'), file('photo.jpg', 'image/jpeg'));
  assert.deepEqual(registry.validate(course), { ok: true, value: { totalSize: 2, assetCount: 2 } });
});

test('reuses and explicitly revokes preview URLs', () => {
  const created = [];
  const revoked = [];
  const registry = createMediaRegistry({
    createObjectURL: blob => {
      const url = `blob:${blob.name}:${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: url => revoked.push(url)
  });
  registry.attach(slot('photo', 'image'), file('photo.png', 'image/png'));

  assert.equal(registry.createPreviewUrl('photo').value, 'blob:photo.png:0');
  assert.equal(registry.createPreviewUrl('photo').value, 'blob:photo.png:0');
  assert.equal(registry.revokePreviewUrl('photo').ok, true);
  assert.deepEqual(revoked, ['blob:photo.png:0']);
  assert.equal(registry.createPreviewUrl('photo').value, 'blob:photo.png:1');
});

test('remove and dispose revoke URLs and clear assets without retaining mutable state', () => {
  const revoked = [];
  const registry = createMediaRegistry({
    createObjectURL: blob => `blob:${blob.name}`,
    revokeObjectURL: url => revoked.push(url)
  });
  registry.attach(slot('one', 'image'), file('one.png', 'image/png'));
  registry.attach(slot('two', 'audio'), file('two.mp3', 'audio/mpeg'));
  registry.createPreviewUrl('one');
  registry.createPreviewUrl('two');

  assert.equal(registry.remove('one').ok, true);
  assert.equal(registry.get('one').value, null);
  registry.dispose();
  assert.equal(registry.get('two').value, null);
  assert.deepEqual(revoked.sort(), ['blob:one.png', 'blob:two.mp3']);
});
