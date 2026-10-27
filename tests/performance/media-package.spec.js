import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';

// Opt in with TIQUI_MEDIA_PERF=1 npm run test:media-performance.
// Decision (Chromium 156, macOS arm64, 2026-10-27): retain 500 MiB total /
// 250 MiB per asset for streaming stored media. Repeated successful runs:
// fixture 2.35–2.42 s, ZIP 2.15–2.19 s, unzip 4.15–4.18 s;
// maximum heartbeat gap 65.6–68.9 ms, peak Chromium RSS 1.78–1.82 GiB.
// RSS sums processes (shared pages may count twice), sampled every 100 ms;
// performance.memory excludes native Blob backing stores. Low-memory/mobile
// devices and whole-archive synchronous APIs are not validated by this spike.
// CoursePackage must preserve chunked work/yields and enforce the total limit.
// These conservative binary sizes cover at least 250 MB per video / 500 MB total.
const VIDEO_BYTES = 250 * 1024 * 1024;
const TOTAL_BYTES = 500 * 1024 * 1024;

test('streams a 500 MiB incompressible package with 250 MiB video assets', async ({ page, browser }) => {
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
  // JS heap omits Blob backing stores. Sample Chromium process RSS as well.
  const sampleMemory = setInterval(() => {
    if (process.platform === 'win32') return;
    execFile('ps', ['-o', 'rss=', '-p', processIds], (error, stdout) => {
      if (error) return;
      const bytes = stdout.trim().split(/\s+/).reduce((sum, kib) => sum + Number(kib) * 1024, 0);
      peakBrowserRssBytes = Math.max(peakBrowserRssBytes, bytes);
    });
  }, 100);

  const metrics = await page.evaluate(async ({ videoBytes }) => {
    const { Zip, ZipPassThrough, Unzip } = globalThis.fflate;
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    const started = performance.now();
    let lastTick = started;
    let maxHeartbeatGapMs = 0;
    let heartbeatCount = 0;
    let peakReportedHeapBytes = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastTick);
      lastTick = now;
      heartbeatCount++;
      peakReportedHeapBytes = Math.max(peakReportedHeapBytes, performance.memory?.usedJSHeapSize || 0);
    }, 20);

    try {
      // Fresh cryptographic bytes avoid an unrealistically compressible repeated fixture.
      let assets = [];
      const expected = {};
      for (const name of ['media/video-a.mp4', 'media/video-b.mp4']) {
        let parts = [];
        for (let offset = 0; offset < videoBytes; offset += 1024 * 1024) {
          const bytes = new Uint8Array(Math.min(1024 * 1024, videoBytes - offset));
          for (let index = 0; index < bytes.length; index += 65_536) {
            crypto.getRandomValues(bytes.subarray(index, index + 65_536));
          }
          parts.push(bytes);
          await pause();
        }
        const blob = new Blob(parts, { type: 'video/mp4' });
        expected[name] = {
          size: blob.size,
          first: Array.from(parts[0].subarray(0, 64)).join(','),
          last: Array.from(parts.at(-1).subarray(-64)).join(','),
        };
        parts = null;
        assets.push({ name, blob });
      }
      const fixtureMs = performance.now() - started;
      let chunks = [];
      let zipError;
      let complete = false;
      const zip = new Zip((error, data, final) => {
        if (error) zipError = error.message;
        else chunks.push(data);
        complete = final;
      });
      const zipStarted = performance.now();
      for (const { name, blob } of assets) {
        // Media is already compressed: store it, stream it, and yield between chunks.
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        const reader = blob.stream().getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          entry.push(value);
          await pause();
        }
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
      if (zipError || !complete) throw new Error(zipError || 'ZIP did not finish');
      const archive = new Blob(chunks, { type: 'application/zip' });
      chunks = null;
      assets = null;
      const zipMs = performance.now() - zipStarted;

      const unpacked = {};
      let unzipError;
      const unzip = new Unzip(entry => {
        const result = { size: 0, first: '', last: '', complete: false };
        unpacked[entry.name] = result;
        entry.ondata = (error, data, final) => {
          if (error) unzipError = error.message;
          else {
            if (!result.size && data.length) result.first = Array.from(data.subarray(0, 64)).join(',');
            if (data.length) {
              result.last = [...(result.last ? result.last.split(',').map(Number) : []),
                ...data.subarray(-64)].slice(-64).join(',');
            }
            result.size += data.length;
            result.complete = final;
          }
        };
        entry.start();
      });
      const unzipStarted = performance.now();
      const reader = archive.stream().getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        unzip.push(value);
        await pause();
      }
      unzip.push(new Uint8Array(0), true);
      if (unzipError) throw new Error(unzipError);
      const unzipMs = performance.now() - unzipStarted;
      await pause();
      return {
        success: true, fixtureMs, zipMs, unzipMs, archiveBytes: archive.size,
        heartbeatCount, maxHeartbeatGapMs, peakReportedHeapBytes, expected, unpacked,
        userAgent: navigator.userAgent,
      };
    } finally {
      clearInterval(heartbeat);
    }
  }, { videoBytes: VIDEO_BYTES }).finally(() => clearInterval(sampleMemory));
  metrics.peakBrowserRssBytes = peakBrowserRssBytes;

  console.log(`MEDIA_PERFORMANCE ${JSON.stringify(metrics)}`);
  expect(errors).toEqual([]);
  expect(metrics.success).toBe(true);
  expect(metrics.archiveBytes).toBeGreaterThanOrEqual(TOTAL_BYTES);
  expect(metrics.archiveBytes).toBeLessThan(TOTAL_BYTES + 4096);
  expect(Object.keys(metrics.unpacked).sort()).toEqual(['media/video-a.mp4', 'media/video-b.mp4']);
  for (const [name, actual] of Object.entries(metrics.unpacked)) {
    expect(actual).toEqual({ ...metrics.expected[name], complete: true });
  }
  expect(metrics.heartbeatCount).toBeGreaterThan(0);
  expect(metrics.maxHeartbeatGapMs).toBeLessThan(1000);
  if (process.platform !== 'win32') {
    expect(metrics.peakBrowserRssBytes).toBeGreaterThan(0);
    expect(metrics.peakBrowserRssBytes).toBeLessThan(2 * 1024 * 1024 * 1024);
  }
});
