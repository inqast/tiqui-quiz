// Synthetic, nonsecret fixtures are encoded by the target browser at test runtime.
export async function createPlayableFixtures(page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const paint = () => { const context = canvas.getContext('2d'); context.fillStyle = '#f06b42'; context.fillRect(0, 0, 32, 24); };
    paint();
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const audioContext = new AudioContext(); await audioContext.resume();
    const oscillator = audioContext.createOscillator(); oscillator.frequency.value = 440;
    const destination = audioContext.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
    const video = canvas.captureStream(10);
    for (const track of destination.stream.getAudioTracks()) video.addTrack(track);
    const animation = setInterval(paint, 100);
    const record = (stream, mimeType) => new Promise((resolve, reject) => {
      if (!MediaRecorder.isTypeSupported(mimeType)) { reject(new Error(`Unsupported fixture encoder: ${mimeType}`)); return; }
      const recorder = new MediaRecorder(stream, { mimeType }); const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onerror = event => reject(event.error);
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.start(); setTimeout(() => recorder.stop(), 1200);
    });
    try {
      const [audio, clip] = await Promise.all([
        record(destination.stream, 'audio/mp4;codecs=mp4a.40.2'),
        record(video, 'video/mp4;codecs=avc1.42001e,mp4a.40.2')
      ]);
      return { image: Array.from(new Uint8Array(await image.arrayBuffer())), audio: Array.from(new Uint8Array(await audio.arrayBuffer())), video: Array.from(new Uint8Array(await clip.arrayBuffer())) };
    } finally {
      clearInterval(animation); oscillator.stop(); video.getTracks().forEach(track => track.stop()); await audioContext.close();
    }
  });
  return {
    image: { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(bytes.image) },
    audio: { name: 'sound.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(bytes.audio) },
    video: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from(bytes.video) }
  };
}

export async function expectPlayback(locator, expect) {
  await expect.poll(() => locator.evaluate(media => Number.isFinite(media.duration) && media.duration > 0 && media.readyState >= 1)).toBe(true);
  await locator.evaluate(async media => { media.muted = true; await media.play(); });
  await expect.poll(() => locator.evaluate(media => media.currentTime)).toBeGreaterThan(0.15);
  await locator.evaluate(media => media.pause());
}
