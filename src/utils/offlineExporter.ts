import type { ProjectData, TimelineSegment } from '../types';
import { getOfflineBgmUrl, getVideoBlobOffline, getVoiceClipOffline } from './offlineStore';

export interface OfflineExportOptions {
  resolution: '720p' | '1080p';
  onProgress: (pct: number, statusText: string) => void;
}

/**
 * Renders the edited gaming timeline completely offline inside the browser
 * using an offscreen Canvas + Web AudioContext + MediaRecorder, then returns
 * a downloadable video Blob ready for Android storage.
 */
export async function renderOfflineVideoExport(
  project: ProjectData,
  options: OfflineExportOptions,
): Promise<{ blob: Blob; fileName: string }> {
  const { resolution, onProgress } = options;
  const targetW = resolution === '1080p' ? 1920 : 1280;
  const targetH = resolution === '1080p' ? 1080 : 720;

  onProgress(5, 'Loading local gameplay media...');

  let videoSrcUrl = project.videoUrl;
  let revokeVideoUrl = false;
  const localBlob = await getVideoBlobOffline(project.id);
  if (localBlob) {
    videoSrcUrl = URL.createObjectURL(localBlob);
    revokeVideoUrl = true;
  }

  const keptSegments: TimelineSegment[] = (project.analysis?.segments || [])
    .filter((s) => s.action === 'keep' && s.endSec - s.startSec >= 0.2)
    .sort((a, b) => a.startSec - b.startSec);

  const segmentsToRender: TimelineSegment[] =
    keptSegments.length > 0
      ? keptSegments
      : [
          {
            id: 'full',
            startSec: 0,
            endSec: Math.max(0.5, project.metadata.durationSec),
            action: 'keep',
            category: 'team-fight',
            label: 'Full Gameplay',
            reason: 'Full video',
            zoomHint: 'none',
            transitionHint: 'cut',
            speedFactor: 1,
            energyScore: 70,
          },
        ];

  const totalOutDuration = segmentsToRender.reduce(
    (sum, s) => sum + (s.endSec - s.startSec) / (project.editing.slowMoOnHighlights ? s.speedFactor || 1 : 1),
    0,
  );

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D rendering canvas.');
  }

  const video = document.createElement('video');
  video.src = videoSrcUrl;
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Could not load gameplay video for offline export.'));
  });

  // Setup Web Audio mixing destination
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const videoGain = audioCtx.createGain();
  videoGain.gain.value =
    project.editing.originalAudioMode === 'mute'
      ? 0
      : project.editing.originalAudioMode === 'duck' && project.sentences.some((s) => s.voiceStatus === 'ready')
        ? 0.35
        : 1.0;

  try {
    const videoSource = audioCtx.createMediaElementSource(video);
    videoSource.connect(videoGain);
    videoGain.connect(dest);
  } catch {
    // Fallback if video has no audio track
  }

  // Load offline BGM if cached
  let bgmAudioEl: HTMLAudioElement | null = null;
  let bgmObjectUrl: string | null = null;
  if (project.editing.bgmTrackId && project.editing.bgmTrackId !== 'none') {
    bgmObjectUrl = await getOfflineBgmUrl(project.editing.bgmTrackId);
    const bgmSrc = bgmObjectUrl || `/api/bgm/${project.editing.bgmTrackId}`;
    try {
      bgmAudioEl = new Audio(bgmSrc);
      bgmAudioEl.loop = true;
      bgmAudioEl.crossOrigin = 'anonymous';
      const bgmSource = audioCtx.createMediaElementSource(bgmAudioEl);
      const bgmGain = audioCtx.createGain();
      bgmGain.gain.value = project.editing.bgmVolume;
      bgmSource.connect(bgmGain);
      bgmGain.connect(dest);
    } catch {
      bgmAudioEl = null;
    }
  }

  // Preload cached voice-over clips
  const voiceAudioMap = new Map<string, AudioBuffer>();
  for (const s of project.sentences) {
    const cachedBlob = await getVoiceClipOffline(project.id, s.id);
    if (cachedBlob) {
      try {
        const buf = await audioCtx.decodeAudioData(await cachedBlob.arrayBuffer());
        voiceAudioMap.set(s.id, buf);
      } catch {
        // ignore decode issue
      }
    }
  }

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: resolution === '1080p' ? 6_000_000 : 3_200_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  await audioCtx.resume();
  recorder.start(250);
  if (bgmAudioEl) {
    void bgmAudioEl.play().catch(() => {});
  }

  let elapsedOut = 0;
  const triggeredVoice = new Set<string>();

  for (let i = 0; i < segmentsToRender.length; i++) {
    const seg = segmentsToRender[i];
    const speed = project.editing.slowMoOnHighlights ? seg.speedFactor || 1 : 1;
    video.playbackRate = Math.max(0.5, Math.min(1.5, speed));
    video.currentTime = seg.startSec;

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    await video.play().catch(() => {});

    await new Promise<void>((resolve) => {
      let animId = 0;
      const segStartWall = performance.now();

      const drawFrame = () => {
        const cur = video.currentTime;
        const wallElapsed = (performance.now() - segStartWall) / 1000;
        const currentOutTime = elapsedOut + wallElapsed;

        // Trigger synced cached voice-over clip
        for (const sentence of project.sentences) {
          if (
            !triggeredVoice.has(sentence.id) &&
            currentOutTime >= sentence.startSec &&
            currentOutTime < sentence.startSec + 0.35
          ) {
            triggeredVoice.add(sentence.id);
            const buf = voiceAudioMap.get(sentence.id);
            if (buf) {
              const src = audioCtx.createBufferSource();
              src.buffer = buf;
              src.playbackRate.value = project.voiceSettings.speakingSpeed || 1;
              src.connect(dest);
              src.start();
            }
          }
        }

        // Draw frame with aspect-fit + zoom + visual effects
        ctx.fillStyle = '#0A0F18';
        ctx.fillRect(0, 0, targetW, targetH);

        const zoom =
          project.editing.zoomIntensity !== 'off' && seg.zoomHint !== 'none'
            ? project.editing.zoomIntensity === 'dynamic'
              ? 1.12
              : 1.06
            : 1.0;

        if (project.editing.visualEffect === 'killcam-contrast' || project.editing.enhanceColor) {
          ctx.filter = 'contrast(1.08) saturate(1.15) brightness(1.02)';
        } else if (project.editing.visualEffect === 'neon-arena') {
          ctx.filter = 'contrast(1.1) saturate(1.25)';
        } else {
          ctx.filter = 'none';
        }

        const vidAspect = (video.videoWidth || 1280) / (video.videoHeight || 720);
        const canvasAspect = targetW / targetH;
        let drawW = targetW;
        let drawH = targetH;
        if (vidAspect > canvasAspect) {
          drawH = targetW / vidAspect;
        } else {
          drawW = targetH * vidAspect;
        }
        drawW *= zoom;
        drawH *= zoom;
        ctx.drawImage(video, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
        ctx.filter = 'none';

        if (project.editing.visualEffect === 'cinematic-vignette') {
          const grad = ctx.createRadialGradient(
            targetW / 2,
            targetH / 2,
            targetH * 0.3,
            targetW / 2,
            targetH / 2,
            targetW * 0.7,
          );
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, 'rgba(0,0,0,0.55)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, targetW, targetH);
        }

        // Active caption overlay
        if (project.editing.autoCaptions) {
          const activeLine = project.sentences.find(
            (s) => currentOutTime >= s.startSec && currentOutTime < s.endSec,
          );
          if (activeLine) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
            ctx.fillRect(targetW * 0.1, targetH - 110, targetW * 0.8, 72);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `600 ${resolution === '1080p' ? 32 : 22}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(activeLine.text.slice(0, 80), targetW / 2, targetH - 74);
          }
        }

        const pct = Math.min(96, Math.max(8, Math.round((currentOutTime / Math.max(1, totalOutDuration)) * 96)));
        onProgress(pct, `Rendering segment ${i + 1}/${segmentsToRender.length} offline...`);

        if (cur >= seg.endSec - 0.05 || video.ended) {
          cancelAnimationFrame(animId);
          video.pause();
          elapsedOut += (seg.endSec - seg.startSec) / speed;
          resolve();
          return;
        }
        animId = requestAnimationFrame(drawFrame);
      };

      animId = requestAnimationFrame(drawFrame);
    });
  }

  if (bgmAudioEl) bgmAudioEl.pause();
  recorder.stop();
  const blob = await recordingDone;

  await audioCtx.close().catch(() => {});
  if (revokeVideoUrl) URL.revokeObjectURL(videoSrcUrl);
  if (bgmObjectUrl) URL.revokeObjectURL(bgmObjectUrl);

  onProgress(100, 'Offline export complete!');
  const safeName = project.title.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
  return {
    blob,
    fileName: `mahavir_${safeName}_${resolution}_offline.webm`,
  };
}
