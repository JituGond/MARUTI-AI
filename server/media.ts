import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type {
  BgmTrackOption,
  ExportJob,
  ProjectData,
  TimelineSegment,
  VideoMetadata,
} from '../src/types.ts';
import type { ProjectPaths } from './store.ts';
import { BGM_DIR } from './store.ts';

const execFileAsync = promisify(execFile);

export const MAX_VIDEO_DURATION_SEC = 900; // 15 minutes

export const BGM_CATALOG: BgmTrackOption[] = [
  {
    id: 'none',
    name: 'No Background Music',
    mood: 'Pure gameplay & commentary audio',
    bpm: 0,
    url: '',
  },
  {
    id: 'boss-rush-edm',
    name: 'Boss Rush Arena',
    mood: 'Aggressive gaming synth & kick',
    bpm: 135,
    url: '/api/bgm/boss-rush-edm',
  },
  {
    id: 'clutch-trap',
    name: 'Clutch Mode 808',
    mood: 'Dark high-stakes montage beat',
    bpm: 140,
    url: '/api/bgm/clutch-trap',
  },
  {
    id: 'victory-anthem',
    name: 'Victory Royale Anthem',
    mood: 'Heroic uplifting win theme',
    bpm: 122,
    url: '/api/bgm/victory-anthem',
  },
  {
    id: 'chill-lobby',
    name: 'Lobby Loadout Lo-Fi',
    mood: 'Chill tutorial & tactical breakdown',
    bpm: 88,
    url: '/api/bgm/chill-lobby',
  },
  {
    id: 'funny-meme',
    name: 'Arcade Fail Bounce',
    mood: 'Playful funny gaming moments',
    bpm: 115,
    url: '/api/bgm/funny-meme',
  },
];

function parseFps(rateStr: string | undefined): number {
  if (!rateStr) return 30;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num / den)) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const parsed = Number(rateStr);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export async function probeVideo(filePath: string, originalFileName: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('Uploaded file does not contain a valid gameplay video stream.');
  }

  const durationSec = Number(parsed.format?.duration || videoStream.duration || 0);
  const stat = fs.statSync(filePath);

  return {
    durationSec: Math.round(durationSec * 100) / 100,
    width: videoStream.width || 1280,
    height: videoStream.height || 720,
    fps: parseFps(videoStream.r_frame_rate),
    hasAudio: Boolean(audioStream),
    codec: videoStream.codec_name || 'h264',
    sizeBytes: Number(parsed.format?.size || stat.size),
    fileName: originalFileName,
  };
}

export async function normalizeVideoIfNeeded(inputPath: string, outputPath: string): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.mp4') {
    if (inputPath !== outputPath) {
      fs.renameSync(inputPath, outputPath);
    }
    return;
  }
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
  if (fs.existsSync(inputPath) && inputPath !== outputPath) {
    fs.unlinkSync(inputPath);
  }
}

export async function extractThumbnails(
  videoPath: string,
  thumbsDir: string,
  durationSec: number,
  projectId: string,
  count = 10,
): Promise<string[]> {
  fs.mkdirSync(thumbsDir, { recursive: true });
  const actualCount = Math.max(4, Math.min(count, 12));
  const step = Math.max(durationSec / actualCount, 0.5);
  const urls: string[] = [];

  for (let i = 0; i < actualCount; i++) {
    const ts = Math.min(Math.max(i * step + step * 0.25, 0), Math.max(durationSec - 0.1, 0));
    const fileName = `thumb_${String(i).padStart(2, '0')}.jpg`;
    const outPath = path.join(thumbsDir, fileName);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss',
        ts.toFixed(2),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-q:v',
        '5',
        outPath,
      ]);
      if (fs.existsSync(outPath)) {
        urls.push(`/api/projects/${projectId}/thumbs/${fileName}`);
      }
    } catch {
      // Skip frame failure
    }
  }
  return urls;
}

function writeStereoWav(
  filePath: string,
  sampleRate: number,
  totalSamples: number,
  renderSample: (i: number, t: number) => [number, number],
): void {
  const numChannels = 2;
  const bitsPerSample = 16;
  const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * 2, 28);
  buffer.writeUInt16LE(numChannels * 2, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const [l, r] = renderSample(i, t);
    const clampedL = Math.max(-1, Math.min(1, l));
    const clampedR = Math.max(-1, Math.min(1, r));
    buffer.writeInt16LE(Math.round(clampedL * 32767), offset);
    buffer.writeInt16LE(Math.round(clampedR * 32767), offset + 2);
    offset += 4;
  }

  fs.writeFileSync(filePath, buffer);
}

export function ensureBackgroundMusicAssets(): void {
  fs.mkdirSync(BGM_DIR, { recursive: true });
  const sampleRate = 44100;
  const durationSec = 16;
  const totalSamples = sampleRate * durationSec;

  const presets: Array<{
    id: string;
    chords: number[][];
    bpm: number;
    brightness: number;
    groove: 'edm' | 'trap' | 'anthem' | 'lofi' | 'arcade';
  }> = [
    {
      id: 'boss-rush-edm',
      chords: [
        [164.81, 246.94, 329.63, 493.88],
        [130.81, 196.0, 261.63, 392.0],
        [146.83, 220.0, 293.66, 440.0],
        [123.47, 185.0, 246.94, 369.99],
      ],
      bpm: 135,
      brightness: 0.72,
      groove: 'edm',
    },
    {
      id: 'clutch-trap',
      chords: [
        [110.0, 164.81, 220.0, 329.63],
        [116.54, 174.61, 233.08, 349.23],
        [98.0, 146.83, 196.0, 293.66],
        [103.83, 155.56, 207.65, 311.13],
      ],
      bpm: 140,
      brightness: 0.65,
      groove: 'trap',
    },
    {
      id: 'victory-anthem',
      chords: [
        [261.63, 329.63, 392.0, 523.25],
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
        [196.0, 246.94, 293.66, 392.0],
      ],
      bpm: 122,
      brightness: 0.5,
      groove: 'anthem',
    },
    {
      id: 'chill-lobby',
      chords: [
        [220.0, 261.63, 329.63, 392.0],
        [196.0, 246.94, 293.66, 349.23],
        [174.61, 220.0, 261.63, 329.63],
        [164.81, 196.0, 246.94, 329.63],
      ],
      bpm: 88,
      brightness: 0.22,
      groove: 'lofi',
    },
    {
      id: 'funny-meme',
      chords: [
        [293.66, 369.99, 440.0],
        [246.94, 293.66, 369.99],
        [261.63, 329.63, 392.0],
        [220.0, 277.18, 329.63],
      ],
      bpm: 115,
      brightness: 0.58,
      groove: 'arcade',
    },
  ];

  for (const preset of presets) {
    const outPath = path.join(BGM_DIR, `${preset.id}.wav`);
    if (fs.existsSync(outPath)) continue;

    const beatSec = 60 / preset.bpm;
    const chordDuration = durationSec / preset.chords.length;

    writeStereoWav(outPath, sampleRate, totalSamples, (_i, t) => {
      const chordIdx = Math.floor(t / chordDuration) % preset.chords.length;
      const chord = preset.chords[chordIdx];
      const beatPhase = (t % beatSec) / beatSec;

      let pad = 0;
      for (let k = 0; k < chord.length; k++) {
        const freq = chord[k];
        const fundamental = Math.sin(2 * Math.PI * freq * t);
        const harmonic = Math.sin(2 * Math.PI * freq * 2 * t) * preset.brightness * 0.3;
        pad += (fundamental + harmonic) / chord.length;
      }

      let env = 0.5;
      let kick = 0;
      if (preset.groove === 'edm' || preset.groove === 'trap' || preset.groove === 'anthem') {
        env = 0.3 + 0.55 * Math.exp(-beatPhase * 4.5);
        if (beatPhase < 0.14) {
          const kFreq = 120 * Math.exp(-beatPhase * 22) + 40;
          kick =
            Math.sin(2 * Math.PI * kFreq * beatPhase * beatSec) *
            Math.exp(-beatPhase * 16) *
            0.38;
        }
      } else if (preset.groove === 'arcade') {
        env = 0.25 + 0.65 * Math.exp(-((t % (beatSec / 2)) / (beatSec / 2)) * 7);
      } else {
        env = 0.45 + 0.2 * Math.sin(2 * Math.PI * (t / beatSec) * 0.5);
      }

      const loopFade =
        t < 0.08 ? t / 0.08 : t > durationSec - 0.08 ? (durationSec - t) / 0.08 : 1;
      const stereoSpread = Math.sin(2 * Math.PI * 0.25 * t) * 0.08;
      const base = (pad * env * 0.42 + kick) * loopFade;
      return [base * (1 - stereoSpread), base * (1 + stereoSpread)];
    });
  }
}

export async function generateSampleGameplayVideo(outPath: string): Promise<void> {
  // Generates a real 24s multi-scene mobile gameplay sample clip (with kills, boring looting, boss fight clutch, silent running, victory)
  const filter = [
    `color=c=#081523:s=1280x720:d=5,drawbox=x=60:y=60:w=1160:h=600:color=#10b981@0.18:t=fill,drawtext=text='HOT DROP - SNIPER HEADSHOT KILL':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=text='[KILL FEED] MahavirPro eliminated Enemy_99 (Headshot +150)':fontcolor=#34d399:fontsize=26:x=(w-text_w)/2:y=(h-text_h)/2+40[v0]`,
    `color=c=#1b222c:s=1280x720:d=5,drawtext=text='EMPTY LOOTING & LOBBY WALK':fontcolor=#94a3b8:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=text='(2 minutes of silent looting with zero enemies nearby...)':fontcolor=#64748b:fontsize=25:x=(w-text_w)/2:y=(h-text_h)/2+35[v1]`,
    `color=c=#0b1630:s=1280x720:d=6,drawbox=x=100:y=90:w=1080:h=540:color=#3b82f6@0.24:t=fill,drawtext=text='BOSS FIGHT & 1v3 SQUAD CLUTCH':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=text='TRIPLE KILL! Final Boss HP 5% -> Eliminated!':fontcolor=#60a5fa:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+40[v2]`,
    `color=c=#191c22:s=1280x720:d=4,drawtext=text='DEAD AIR / WAITING FOR ZONE':fontcolor=#a1a1aa:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=text='(Quiet rotation across empty map...)':fontcolor=#71717a:fontsize=25:x=(w-text_w)/2:y=(h-text_h)/2+35[v3]`,
    `color=c=#053e2f:s=1280x720:d=4,drawtext=text='VICTORY ROYALE - #1 MATCH WON':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=text='14 Kills · MVP Damage ·GG!':fontcolor=#a7f3d0:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+40[v4]`,
    `sine=frequency=520:sample_rate=44100:duration=5,volume=0.22[a0]`,
    `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=5[a1]`,
    `sine=frequency=660:sample_rate=44100:duration=6,volume=0.26[a2]`,
    `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=4[a3]`,
    `sine=frequency=587.33:sample_rate=44100:duration=4,volume=0.20[a4]`,
    `[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4]concat=n=5:v=1:a=1[vout][aout]`,
  ].join(';');

  await execFileAsync('ffmpeg', [
    '-y',
    '-filter_complex',
    filter,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outPath,
  ]);
}

export function getWavDurationSec(wavPath: string): number {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44) return 0;
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.readUInt32LE(40);
  if (byteRate <= 0) return 0;
  return Math.round((dataSize / byteRate) * 100) / 100;
}

export function concatenateWavFiles(wavPaths: string[], outPath: string): number {
  const valid = wavPaths.filter((p) => fs.existsSync(p));
  if (valid.length === 0) {
    throw new Error('No voice-over audio clips available to combine.');
  }

  const first = fs.readFileSync(valid[0]);
  if (first.length < 44) {
    throw new Error('Invalid WAV header in first clip.');
  }

  const header = Buffer.from(first.subarray(0, 44));
  const pcmParts: Buffer[] = [first.subarray(44)];

  for (let i = 1; i < valid.length; i++) {
    const clip = fs.readFileSync(valid[i]);
    if (clip.length > 44) {
      pcmParts.push(clip.subarray(44));
    }
  }

  const totalPcm = Buffer.concat(pcmParts);
  header.writeUInt32LE(36 + totalPcm.length, 4);
  header.writeUInt32LE(totalPcm.length, 40);

  fs.writeFileSync(outPath, Buffer.concat([header, totalPcm]));
  return getWavDurationSec(outPath);
}

function getKeptSegments(project: ProjectData): TimelineSegment[] {
  const segs = project.analysis?.segments ?? [];
  const kept = segs
    .filter((s) => s.action === 'keep' && s.endSec - s.startSec >= 0.15)
    .sort((a, b) => a.startSec - b.startSec);

  if (kept.length > 0) return kept;

  return [
    {
      id: 'full',
      startSec: 0,
      endSec: Math.max(project.metadata.durationSec, 1),
      action: 'keep',
      category: 'team-fight',
      label: 'Full Gameplay',
      reason: 'Entire match retained',
      zoomHint: 'none',
      transitionHint: 'cut',
      speedFactor: 1,
      energyScore: 75,
    },
  ];
}

export async function renderProjectExport(
  project: ProjectData,
  job: ExportJob,
  paths: ProjectPaths,
  onProgress: (pct: number) => void,
): Promise<{ outputPath: string; sizeBytes: number }> {
  const ext = job.presetId === 'audio-master-wav' ? 'wav' : 'mp4';
  const outputPath = path.join(paths.exportsDir, `${job.id}.${ext}`);

  const readySentences = project.sentences
    .filter((s) => s.voiceStatus === 'ready' && s.audioUrl)
    .map((s) => ({
      sentence: s,
      wavPath: path.join(paths.voiceDir, `${s.id}.wav`),
    }))
    .filter((item) => fs.existsSync(item.wavPath));

  if (job.presetId === 'audio-master-wav') {
    onProgress(20);
    if (readySentences.length === 0) {
      throw new Error('No generated voice-over clips found. Generate commentary audio first.');
    }
    concatenateWavFiles(
      readySentences.map((r) => r.wavPath),
      outputPath,
    );
    onProgress(100);
    const stat = fs.statSync(outputPath);
    return { outputPath, sizeBytes: stat.size };
  }

  const keptSegments = getKeptSegments(project);
  const totalOutDuration = keptSegments.reduce(
    (acc, s) => acc + (s.endSec - s.startSec) / (s.speedFactor || 1),
    0,
  );

  const args: string[] = ['-y', '-i', paths.sourceVideo];
  let nextInputIdx = 1;

  const hasBgm = project.editing.bgmTrackId && project.editing.bgmTrackId !== 'none';
  const bgmPath = hasBgm ? path.join(BGM_DIR, `${project.editing.bgmTrackId}.wav`) : '';
  const bgmInputIdx = hasBgm && fs.existsSync(bgmPath) ? nextInputIdx++ : -1;
  if (bgmInputIdx !== -1) {
    args.push('-stream_loop', '-1', '-i', bgmPath);
  }

  let voiceItems = readySentences;
  let stitchedVoicePath: string | null = null;
  if (readySentences.length > 40) {
    stitchedVoicePath = path.join(paths.exportsDir, `${job.id}_voice_stitched.wav`);
    concatenateWavFiles(
      readySentences.map((r) => r.wavPath),
      stitchedVoicePath,
    );
    voiceItems = [
      {
        sentence: readySentences[0].sentence,
        wavPath: stitchedVoicePath,
      },
    ];
  }

  const voiceInputs: Array<{ inputIdx: number; delayMs: number }> = [];
  for (const item of voiceItems) {
    const idx = nextInputIdx++;
    args.push('-i', item.wavPath);
    const delayMs = Math.max(0, Math.round(item.sentence.startSec * 1000));
    voiceInputs.push({ inputIdx: idx, delayMs });
  }

  const filterParts: string[] = [];

  let targetW = 1920;
  let targetH = 1080;
  if (job.presetId === 'youtube-720p') {
    targetW = 1280;
    targetH = 720;
  } else if (job.presetId === 'youtube-shorts') {
    targetW = 1080;
    targetH = 1920;
  }

  const srcW = Math.max(2, Math.round((project.metadata.width || 1280) / 2) * 2);
  const srcH = Math.max(2, Math.round((project.metadata.height || 720) / 2) * 2);

  const segVideoLabels: string[] = [];
  const segAudioLabels: string[] = [];

  keptSegments.forEach((seg, idx) => {
    const start = Math.max(0, seg.startSec).toFixed(3);
    const end = Math.max(seg.startSec + 0.15, seg.endSec).toFixed(3);
    const speed = project.editing.slowMoOnHighlights ? seg.speedFactor || 1 : 1;
    const clampedSpeed = Math.max(0.5, Math.min(1.5, speed));
    const vLbl = `vs${idx}`;

    let vChain = `[0:v]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${clampedSpeed.toFixed(2)}`;

    if (project.editing.zoomIntensity !== 'off' && seg.zoomHint !== 'none') {
      const zoomFactor = project.editing.zoomIntensity === 'dynamic' ? 1.15 : 1.07;
      const zw = Math.max(srcW + 2, Math.round((srcW * zoomFactor) / 2) * 2);
      const zh = Math.max(srcH + 2, Math.round((srcH * zoomFactor) / 2) * 2);
      vChain += `,scale=${zw}:${zh}:flags=bicubic,crop=${srcW}:${srcH}:(iw-${srcW})/2:(ih-${srcH})/2,setsar=1`;
    } else {
      vChain += `,scale=${srcW}:${srcH}:flags=bilinear,setsar=1`;
    }

    if (project.editing.transitionType === 'dip-black' && idx > 0) {
      vChain += `,fade=t=in:st=0:d=0.22`;
    } else if (project.editing.transitionType === 'flash' && idx > 0) {
      vChain += `,fade=t=in:st=0:d=0.14:color=white`;
    }

    vChain += `[${vLbl}]`;
    filterParts.push(vChain);
    segVideoLabels.push(`[${vLbl}]`);

    if (project.metadata.hasAudio) {
      const aLbl = `as${idx}`;
      filterParts.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${clampedSpeed.toFixed(2)},aformat=sample_rates=44100:channel_layouts=stereo[${aLbl}]`,
      );
      segAudioLabels.push(`[${aLbl}]`);
    }
  });

  if (keptSegments.length === 1) {
    filterParts.push(`${segVideoLabels[0]}null[vcat]`);
  } else {
    filterParts.push(`${segVideoLabels.join('')}concat=n=${keptSegments.length}:v=1:a=0[vcat]`);
  }

  let vPost = `[vcat]`;
  if (job.presetId === 'youtube-shorts') {
    vPost += `split=2[bg][fg];[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:5[bgb];[fg]scale=${targetW}:-2:force_original_aspect_ratio=decrease[fgb];[bgb][fgb]overlay=(W-w)/2:(H-h)/2`;
  } else {
    vPost += `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=#0A0F18`;
  }

  if (project.editing.visualEffect === 'killcam-contrast' || project.editing.enhanceColor) {
    vPost += `,eq=contrast=1.08:saturation=1.15:brightness=0.01,unsharp=5:5:0.5:5:5:0.0`;
  } else if (project.editing.visualEffect === 'neon-arena') {
    vPost += `,eq=contrast=1.1:saturation=1.28,unsharp=5:5:0.6:5:5:0.0`;
  } else if (project.editing.visualEffect === 'cinematic-vignette') {
    vPost += `,eq=contrast=1.06:saturation=1.08,vignette=PI/4`;
  }

  vPost += `,format=yuv420p[vout]`;
  filterParts.push(vPost);

  const audioMixInputs: string[] = [];

  if (project.metadata.hasAudio && project.editing.originalAudioMode !== 'mute') {
    if (segAudioLabels.length === 1) {
      filterParts.push(`${segAudioLabels[0]}anull[orig_cat]`);
    } else {
      filterParts.push(
        `${segAudioLabels.join('')}concat=n=${segAudioLabels.length}:v=0:a=1[orig_cat]`,
      );
    }
    const origVol =
      project.editing.originalAudioMode === 'duck' && voiceInputs.length > 0 ? 0.28 : 1.0;
    filterParts.push(`[orig_cat]volume=${origVol.toFixed(2)}[orig_ready]`);
    audioMixInputs.push('[orig_ready]');
  }

  if (bgmInputIdx !== -1) {
    const bgmVol = Math.max(0.02, Math.min(0.8, project.editing.bgmVolume));
    filterParts.push(
      `[${bgmInputIdx}:a]atrim=duration=${Math.max(totalOutDuration, 1).toFixed(2)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,volume=${bgmVol.toFixed(2)}[bgm_ready]`,
    );
    audioMixInputs.push('[bgm_ready]');
  }

  voiceInputs.forEach((v, idx) => {
    const lbl = `vo${idx}`;
    filterParts.push(
      `[${v.inputIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${v.delayMs}|${v.delayMs},volume=1.18[${lbl}]`,
    );
    audioMixInputs.push(`[${lbl}]`);
  });

  if (audioMixInputs.length === 0) {
    filterParts.push(
      `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${Math.max(totalOutDuration, 1).toFixed(2)}[aout]`,
    );
  } else if (audioMixInputs.length === 1) {
    filterParts.push(`${audioMixInputs[0]}anull[aout]`);
  } else {
    filterParts.push(
      `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:normalize=0,atrim=duration=${Math.max(totalOutDuration, 1).toFixed(2)}[aout]`,
    );
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    job.presetId === 'youtube-720p' ? '23' : '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrLog = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const us = Number(line.replace('out_time_us=', '').trim());
          if (Number.isFinite(us) && totalOutDuration > 0) {
            const pct = Math.min(
              98,
              Math.max(5, Math.round((us / 1_000_000 / totalOutDuration) * 100)),
            );
            onProgress(pct);
          }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrLog += chunk.toString();
      if (stderrLog.length > 4000) stderrLog = stderrLog.slice(-4000);
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (stitchedVoicePath && fs.existsSync(stitchedVoicePath)) {
        try {
          fs.unlinkSync(stitchedVoicePath);
        } catch {
          // ignore
        }
      }
      if (code === 0 && fs.existsSync(outputPath)) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`FFmpeg export failed (exit ${code}): ${stderrLog.slice(-400)}`));
      }
    });
  });

  const stat = fs.statSync(outputPath);
  return { outputPath, sizeBytes: stat.size };
}
