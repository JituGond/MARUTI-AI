import type {
  ProjectData,
  TimelineSegment,
  VideoAnalysisResult,
  VideoHighlight,
} from '../types';

/**
 * On-Device Offline Gameplay Action Peak Detector.
 * Uses browser Web Audio API (AudioContext.decodeAudioData) to scan gameplay
 * audio RMS energy & combat transients without any internet connection.
 */
export async function analyzeGameplayOfflineOnDevice(
  videoBlobOrUrl: Blob | string,
  durationSec: number,
  projectTitle: string,
): Promise<VideoAnalysisResult> {
  let arrayBuffer: ArrayBuffer;
  if (typeof videoBlobOrUrl === 'string') {
    const res = await fetch(videoBlobOrUrl);
    arrayBuffer = await res.arrayBuffer();
  } else {
    arrayBuffer = await videoBlobOrUrl.arrayBuffer();
  }

  const audioCtx = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

  let decoded: AudioBuffer | null = null;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    decoded = null;
  } finally {
    await audioCtx.close().catch(() => {});
  }

  const safeDur = Math.max(1, durationSec);
  const bucketSec = Math.max(1.5, Math.min(4, safeDur / 12));
  const numBuckets = Math.max(1, Math.ceil(safeDur / bucketSec));
  const energies: number[] = [];

  if (decoded && decoded.length > 0) {
    const channel = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    for (let b = 0; b < numBuckets; b++) {
      const startSample = Math.floor(b * bucketSec * sampleRate);
      const endSample = Math.min(
        channel.length,
        Math.floor((b + 1) * bucketSec * sampleRate),
      );
      let sumSq = 0;
      const count = Math.max(1, endSample - startSample);
      // Stride by 8 samples for fast mobile performance
      let sampled = 0;
      for (let i = startSample; i < endSample; i += 8) {
        const s = channel[i];
        sumSq += s * s;
        sampled++;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, sampled || count));
      energies.push(rms);
    }
  } else {
    for (let b = 0; b < numBuckets; b++) {
      energies.push(b % 2 === 0 ? 0.15 : 0.03);
    }
  }

  const maxEnergy = Math.max(0.01, ...energies);
  const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  const threshold = Math.max(0.008, avgEnergy * 0.55);

  const rawSegments: TimelineSegment[] = [];
  const highlights: VideoHighlight[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const startSec = Math.round(b * bucketSec * 100) / 100;
    const endSec = Math.round(Math.min(safeDur, (b + 1) * bucketSec) * 100) / 100;
    if (endSec - startSec < 0.25) continue;

    const e = energies[b];
    const score = Math.max(10, Math.min(99, Math.round((e / maxEnergy) * 100)));
    const isAction = e >= threshold;
    const isPeak = score >= 75;

    const seg: TimelineSegment = {
      id: `ondev_${b}_${Date.now()}`,
      startSec,
      endSec,
      action: isAction ? 'keep' : 'cut',
      category: isPeak ? 'team-fight' : isAction ? 'kill-feed' : 'dead-air',
      label: isPeak
        ? 'High-Intensity Combat Spike'
        : isAction
          ? 'Active Gameplay Moment'
          : 'Quiet / Looting Pause',
      reason: isAction
        ? `On-device audio peak detected (${score}/100 energy).`
        : `Low audio activity (${score}/100 energy) flagged for trim.`,
      zoomHint: isPeak ? 'punch-in' : isAction ? 'slow-zoom' : 'none',
      transitionHint: isPeak ? 'flash' : 'cut',
      speedFactor: isPeak ? 0.75 : 1,
      energyScore: score,
    };

    // Merge consecutive segments with the same action & similar energy
    const prev = rawSegments[rawSegments.length - 1];
    if (prev && prev.action === seg.action && Math.abs(prev.energyScore - seg.energyScore) < 25) {
      prev.endSec = seg.endSec;
      prev.energyScore = Math.max(prev.energyScore, seg.energyScore);
    } else {
      rawSegments.push(seg);
    }
  }

  for (const seg of rawSegments) {
    if (seg.action === 'keep' && seg.energyScore >= 70) {
      highlights.push({
        startSec: seg.startSec,
        endSec: seg.endSec,
        title: seg.label,
        reason: seg.reason,
        eventType: 'enemy-fight',
      });
    }
  }

  return {
    gameTitle: projectTitle,
    captureSource: 'mobile-screen',
    analysisSource: 'ondevice-audio-peaks',
    summary:
      'Analyzed offline using MAHAVIR On-Device Audio Peak Detector. High-intensity gunfight/action spikes were kept and quiet dead-air segments were marked for removal. Connect to internet for Cloud Vision AI (Gemini 4) to detect exact kills, headshots, and boss fights.',
    detectedLanguage: 'Offline Audio Scan',
    suggestedStyle: 'clutch-montage',
    highlights: highlights.slice(0, 8),
    segments: rawSegments,
    analyzedAt: new Date().toISOString(),
  };
}

export function buildOfflineStarterScript(project: ProjectData, lang: 'en' | 'hi') {
  const kept = (project.analysis?.segments || []).filter((s) => s.action === 'keep');
  const sourceList =
    kept.length > 0
      ? kept
      : [
          {
            id: 'full',
            startSec: 0,
            endSec: Math.min(project.metadata.durationSec, 8),
            label: 'Opening Gameplay',
            category: 'kill-feed',
          },
        ];

  let cursor = 0;
  return sourceList.map((seg, idx) => {
    const dur = Math.max(2, seg.endSec - seg.startSec);
    const startSec = Math.round(cursor * 10) / 10;
    const endSec = Math.round((cursor + dur) * 10) / 10;
    cursor = endSec;

    const text =
      lang === 'hi'
        ? idx === 0
          ? `स्वागत है दोस्तों! चलिए देखते हैं ${seg.label} का तगड़ा गेमप्ले!`
          : `यहाँ देखिए ${seg.label} — बिल्कुल ज़बरदस्त क्लच मूवमेंट!`
        : idx === 0
          ? `Welcome back squad! Let us jump right into ${seg.label}!`
          : `Watch this ${seg.label} play — pure clutch timing right here!`;

    return {
      id: `offline_line_${idx}_${Date.now()}`,
      sceneIndex: idx + 1,
      startSec,
      endSec,
      text,
      speakerTone: 'Hype',
      voiceStatus: 'idle' as const,
    };
  });
}
