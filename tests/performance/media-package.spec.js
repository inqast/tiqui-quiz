import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';

// Opt in with TIQUI_MEDIA_PERF=1 npm run test:media-performance.
// Full production lifecycle, with both old and imported projects retained.
// The former 500 MiB limit failed this measurement (4.45 s heartbeat gap,
// 2.57 GiB RSS). Keep this opt-in gate for the measured 250 MiB limit.
// RSS sums Chromium processes; shared pages can count more than once.
const VIDEO_BYTES = 250 * 1024 * 1024;
const TOTAL_BYTES = 250 * 1024 * 1024;

test('roundtrips a retained 250 MiB project through production save open and student export', async ({ page, browser }) => {
  test.skip(process.env.TIQUI_MEDIA_PERF !== '1', 'Requires explicit TIQUI_MEDIA_PERF=1');
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Chromium page crashed'));
  await page.goto(pathToFileURL(resolve('quiz.html')).href);
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  await session.detach();
  const processIds = processInfo.map(info => info.id).join(',');
  let peakBrowserRssBytes = 0;
  const sampleMemory = setInterval(() => {
    if (process.platform === 'win32') return;
    execFile('ps', ['-o', 'rss=', '-p', processIds], (error, stdout) => {
      if (error) return;
      const bytes = stdout.trim().split(/\s+/).reduce((sum, kib) => sum + Number(kib) * 1024, 0);
      peakBrowserRssBytes = Math.max(peakBrowserRssBytes, bytes);
    });
  }, 100);
  const metrics = await page.evaluate(async ({ videoBytes }) => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    let lastTick = performance.now(), maxHeartbeatGapMs = 0, heartbeatCount = 0, peakReportedHeapBytes = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now(); maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastTick); lastTick = now;
      heartbeatCount++; peakReportedHeapBytes = Math.max(peakReportedHeapBytes, performance.memory?.usedJSHeapSize || 0);
    }, 20);
    const timings = {};
    const measure = async (name, work) => { const start = performance.now(); const result = await work(); timings[name] = performance.now() - start; if (!result.ok) throw new Error(JSON.stringify(result.errors)); await pause(); return result.value; };
    try {
      const source = '# Performance\nОписание: Production package lifecycle\n\n## Lesson\nМедиа: video:video-a\nОписание медиа: Intro\n\n### Выбор\nQuestion?\n- [x] Yes\n- [ ] No\n';
      const parsed = parseDocument(source); if (parsed.errors.length) throw new Error(parsed.errors.join(';'));
      const oldRegistry = createMediaRegistry();
      const slots = [parsed.course.lessons[0].media];
      const expected = {};
      for (const slot of slots) {
        let parts = [];
        for (let offset = 0; offset < videoBytes; offset += 1024 * 1024) {
          const bytes = new Uint8Array(Math.min(1024 * 1024, videoBytes - offset));
          for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
          parts.push(bytes); await pause();
        }
        expected[slot.id] = { first: Array.from(parts[0].subarray(0, 64)).join(','), last: Array.from(parts.at(-1).subarray(-64)).join(',') };
        const attached = oldRegistry.attach(slot, new File(parts, slot.id + '.mp4', { type: 'video/mp4' }));
        if (!attached.ok) throw new Error(JSON.stringify(attached.errors));
        parts = null;
      }
      // Use the exact production API, including full SHA-256 buffers and retained
      // old registry + archive + candidate payloads during transactional import.
      const packageApi = createCoursePackage(fflate, { digest: (algorithm, bytes) => crypto.subtle.digest(algorithm, bytes) });
      const archive = await measure('saveMs', () => packageApi.saveProject({ source, course: parsed.course, registry: oldRegistry }));
      const imported = await measure('openMs', () => packageApi.openProject(archive));
      const importedRegistry = createMediaRegistry();
      for (const asset of imported.assets) {
        const slot = slots.find(slot => slot.id === asset.slotId);
        if (!importedRegistry.attach(slot, new File([asset.blob], asset.filename, { type: asset.mimeType })).ok) throw new Error('Imported asset rejected');
      }
      const paths = Object.fromEntries(imported.assets.map(asset => [asset.slotId, 'media/' + asset.filename]));
      const student = await measure('studentMs', () => packageApi.exportStudentCourse({ course: parsed.course, registry: importedRegistry, indexHtml: createStudentHtml(parsed.course, paths) }));
      const actual = {};
      for (const asset of imported.assets) actual[asset.slotId] = {
        first: Array.from(new Uint8Array(await asset.blob.slice(0, 64).arrayBuffer())).join(','),
        last: Array.from(new Uint8Array(await asset.blob.slice(-64).arrayBuffer())).join(',')
      };
      // Keep every returned payload and both registry owners alive through the measurement.
      globalThis.retainedPerformanceProject = { oldRegistry, archive, imported, importedRegistry, student };
      await pause();
      return { ...timings, archiveBytes: archive.size, studentBytes: student.size, importedBytes: imported.assets.reduce((sum, asset) => sum + asset.size, 0), retainedOldBytes: oldRegistry.exportManifest().value.reduce((sum, asset) => sum + asset.size, 0), sourceMatches: imported.source === source, expected, actual, heartbeatCount, maxHeartbeatGapMs, peakReportedHeapBytes, userAgent: navigator.userAgent };
    } finally { clearInterval(heartbeat); }
  }, { videoBytes: VIDEO_BYTES }).finally(() => clearInterval(sampleMemory));
  metrics.peakBrowserRssBytes = peakBrowserRssBytes;
  console.log(`MEDIA_PERFORMANCE ${JSON.stringify(metrics)}`);
  expect(errors).toEqual([]);
  expect(metrics.sourceMatches).toBe(true);
  expect(metrics.archiveBytes).toBeGreaterThanOrEqual(TOTAL_BYTES);
  expect(metrics.studentBytes).toBeGreaterThanOrEqual(TOTAL_BYTES);
  expect(metrics.importedBytes).toBe(TOTAL_BYTES);
  expect(metrics.retainedOldBytes).toBe(TOTAL_BYTES);
  expect(metrics.actual).toEqual(metrics.expected);
  expect(metrics.heartbeatCount).toBeGreaterThan(0);
  expect(metrics.maxHeartbeatGapMs).toBeLessThan(1000);
  if (process.platform !== 'win32') {
    expect(metrics.peakBrowserRssBytes).toBeGreaterThan(0);
    expect(metrics.peakBrowserRssBytes).toBeLessThan(2 * 1024 * 1024 * 1024);
  }
});
