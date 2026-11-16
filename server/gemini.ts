import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import type {
  EditingStyleId,
  GamingEventType,
  ProjectData,
  ScriptLanguage,
  ScriptSentence,
  ScriptStyleId,
  SegmentCategory,
  TimelineSegment,
  TransitionHint,
  VideoAnalysisResult,
  VoiceSettings,
  ZoomHint,
} from '../src/types.ts';
import { getGeminiFileCache, setGeminiFileCache } from './store.ts';

function getGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withGeminiRetry<T>(
  fn: (modelOverride?: string) => Promise<T>,
  fallbackModels: string[] = [],
): Promise<T> {
  const attempts = [undefined, undefined, ...fallbackModels];
  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await fn(attempts[i]);
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.toLowerCase().includes('high demand');
      if (!isTransient || i === attempts.length - 1) {
        throw err;
      }
      await sleep(1500 * (i + 1));
    }
  }
  throw lastError;
}

export async function ensureGeminiVideoFile(
  projectId: string,
  videoPath: string,
  mimeType = 'video/mp4',
): Promise<{ uri: string; mimeType: string; name: string }> {
  const ai = getGeminiClient();
  const cached = getGeminiFileCache(projectId);

  if (cached) {
    try {
      const existing = await ai.files.get({ name: cached.name });
      if (existing.state === 'ACTIVE' && existing.uri) {
        return cached;
      }
    } catch {
      // Re-upload if expired or inaccessible
    }
  }

  const uploaded = await ai.files.upload({
    file: videoPath,
    config: { mimeType },
  });

  if (!uploaded.name) {
    throw new Error('Failed to upload gameplay video to Gemini Files API.');
  }

  let current = uploaded;
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (current.state === 'ACTIVE') {
      break;
    }
    if (current.state === 'FAILED') {
      throw new Error(
        `Gemini gameplay processing failed: ${current.error?.message || 'Unknown processing error'}`,
      );
    }
    await sleep(2000);
    current = await ai.files.get({ name: uploaded.name });
  }

  if (current.state !== 'ACTIVE' || !current.uri) {
    throw new Error('Timed out waiting for Gemini gameplay video processing.');
  }

  const info = {
    uri: current.uri,
    mimeType: current.mimeType || mimeType,
    name: current.name || uploaded.name,
  };
  setGeminiFileCache(projectId, info);
  return info;
}

function normalizeSegments(
  rawSegments: Array<{
    startSec: number;
    endSec: number;
    action: string;
    category: string;
    label: string;
    reason: string;
    zoomHint: string;
    transitionHint: string;
    speedFactor?: number;
    energyScore: number;
  }>,
  durationSec: number,
): TimelineSegment[] {
  const validActions = new Set(['keep', 'cut']);
  const validCategories = new Set<SegmentCategory>([
    'kill-feed',
    'headshot',
    'boss-fight',
    'team-fight',
    'victory',
    'defeat',
    'clutch',
    'looting-boring',
    'lobby-wait',
    'dead-air',
    'repetition',
  ]);
  const validZooms = new Set<ZoomHint>(['none', 'punch-in', 'slow-zoom']);
  const validTransitions = new Set<TransitionHint>(['cut', 'crossfade', 'whip', 'flash']);
  const validSpeeds = [0.5, 0.75, 1, 1.25];

  const snapSpeed = (val?: number): number => {
    if (!val || !Number.isFinite(val)) return 1;
    return validSpeeds.reduce((prev, curr) =>
      Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev,
    );
  };

  const cleaned = rawSegments
    .map((s) => ({
      startSec: Math.max(0, Math.min(durationSec, Number(s.startSec) || 0)),
      endSec: Math.max(0, Math.min(durationSec, Number(s.endSec) || 0)),
      action: (validActions.has(s.action) ? s.action : 'keep') as 'keep' | 'cut',
      category: (validCategories.has(s.category as SegmentCategory)
        ? s.category
        : 'team-fight') as SegmentCategory,
      label: (s.label || 'Gameplay Scene').slice(0, 80),
      reason: (s.reason || 'Analyzed by MAHAVIR Gaming AI').slice(0, 220),
      zoomHint: (validZooms.has(s.zoomHint as ZoomHint) ? s.zoomHint : 'none') as ZoomHint,
      transitionHint: (validTransitions.has(s.transitionHint as TransitionHint)
        ? s.transitionHint
        : 'cut') as TransitionHint,
      speedFactor: snapSpeed(s.speedFactor),
      energyScore: Math.max(1, Math.min(100, Math.round(Number(s.energyScore) || 65))),
    }))
    .filter((s) => s.endSec - s.startSec >= 0.25)
    .sort((a, b) => a.startSec - b.startSec);

  if (cleaned.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        startSec: 0,
        endSec: durationSec,
        action: 'keep',
        category: 'team-fight',
        label: 'Full Gameplay',
        reason: 'Retained full match footage.',
        zoomHint: 'slow-zoom',
        transitionHint: 'cut',
        speedFactor: 1,
        energyScore: 75,
      },
    ];
  }

  const timeline: TimelineSegment[] = [];
  let cursor = 0;

  for (const seg of cleaned) {
    const start = Math.max(cursor, seg.startSec);
    if (start - cursor >= 0.4) {
      timeline.push({
        id: crypto.randomUUID(),
        startSec: Math.round(cursor * 100) / 100,
        endSec: Math.round(start * 100) / 100,
        action: 'keep',
        category: 'team-fight',
        label: 'Match Continuity',
        reason: 'Bridging gameplay retained for flow.',
        zoomHint: 'none',
        transitionHint: 'cut',
        speedFactor: 1,
        energyScore: 60,
      });
    }
    const end = Math.max(start + 0.25, seg.endSec);
    if (start < durationSec) {
      timeline.push({
        id: crypto.randomUUID(),
        startSec: Math.round(start * 100) / 100,
        endSec: Math.round(Math.min(durationSec, end) * 100) / 100,
        action: seg.action,
        category: seg.category,
        label: seg.label,
        reason: seg.reason,
        zoomHint: seg.zoomHint,
        transitionHint: seg.transitionHint,
        speedFactor: seg.action === 'cut' ? 1 : seg.speedFactor,
        energyScore: seg.energyScore,
      });
      cursor = Math.min(durationSec, end);
    }
  }

  if (durationSec - cursor >= 0.4) {
    timeline.push({
      id: crypto.randomUUID(),
      startSec: Math.round(cursor * 100) / 100,
      endSec: Math.round(durationSec * 100) / 100,
      action: 'keep',
      category: 'victory',
      label: 'Closing Match Outcome',
      reason: 'Final match screen retained.',
      zoomHint: 'none',
      transitionHint: 'crossfade',
      speedFactor: 1,
      energyScore: 72,
    });
  }

  return timeline;
}

export async function analyzeVideoWithGemini(
  projectId: string,
  videoPath: string,
  durationSec: number,
): Promise<VideoAnalysisResult> {
  const ai = getGeminiClient();
  const fileRef = await ensureGeminiVideoFile(projectId, videoPath, 'video/mp4');

  const prompt = `You are MAHAVIR AI, a specialist gaming video editor analyzing gameplay footage (mobile screen recording or camera gameplay recording, total duration: ${durationSec.toFixed(2)} seconds).
Watch and listen carefully to the ENTIRE gameplay video from 0.00s to ${durationSec.toFixed(2)}s:
1. Identify the game title/genre and whether it looks like a mobile screen recording, camera gameplay recording, or PC/console capture.
2. Detect all exciting gaming moments: kills, headshots, enemy fights, boss fights, clutch plays, victories, and defeats.
3. Detect boring, silent, lobby-waiting, slow looting, repeated, or unnecessary sections and mark them as action: "cut".
4. Mark exciting combat/highlights as action: "keep". Recommend speedFactor (0.5 or 0.75 for dramatic headshot/boss-finisher slow-motion, 1.0 for normal action), zoomHint ("none", "punch-in", "slow-zoom"), and transitionHint ("cut", "crossfade", "whip", "flash").
5. Suggest the best gaming editing style from: "clutch-montage", "boss-epic", "funny-fails", "pro-esports", "youtube-letsplay".
6. Keep all timestamps strictly between 0 and ${durationSec.toFixed(2)}.`;

  const response = await withGeminiRetry(
    (modelOverride) =>
      ai.models.generateContent({
        model: modelOverride || 'gemini-4-hydrogen',
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: fileRef.uri,
              mimeType: fileRef.mimeType,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction:
        'You are a precision gaming gameplay analyst. Return strict JSON matching the schema with accurate timestamps grounded in the actual gameplay footage.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          gameTitle: {
            type: Type.STRING,
            description: 'Detected game name or genre (e.g., BGMI / PUBG Mobile, Free Fire, Valorant, Boss Battle RPG).',
          },
          captureSource: {
            type: Type.STRING,
            description: 'One of: mobile-screen, camera-gameplay, pc-console',
          },
          summary: {
            type: Type.STRING,
            description: '2-3 sentence summary of gameplay highlights, kills, fights, and cut opportunities.',
          },
          detectedLanguage: {
            type: Type.STRING,
            description: 'Primary spoken/HUD language detected (e.g., English, Hindi, Hinglish).',
          },
          suggestedStyle: {
            type: Type.STRING,
            description:
              'One of: clutch-montage, boss-epic, funny-fails, pro-esports, youtube-letsplay',
          },
          highlights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                title: { type: Type.STRING },
                reason: { type: Type.STRING },
                eventType: {
                  type: Type.STRING,
                  description: 'One of: kill, headshot, boss-fight, enemy-fight, victory, defeat, clutch',
                },
              },
              required: ['startSec', 'endSec', 'title', 'reason', 'eventType'],
            },
          },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                action: { type: Type.STRING, description: 'keep or cut' },
                category: {
                  type: Type.STRING,
                  description:
                    'kill-feed, headshot, boss-fight, team-fight, victory, defeat, clutch, looting-boring, lobby-wait, dead-air, or repetition',
                },
                label: { type: Type.STRING },
                reason: { type: Type.STRING },
                zoomHint: { type: Type.STRING, description: 'none, punch-in, or slow-zoom' },
                transitionHint: {
                  type: Type.STRING,
                  description: 'cut, crossfade, whip, or flash',
                },
                speedFactor: {
                  type: Type.NUMBER,
                  description: 'Playback speed: 0.5, 0.75, 1, or 1.25',
                },
                energyScore: { type: Type.INTEGER },
              },
              required: [
                'startSec',
                'endSec',
                'action',
                'category',
                'label',
                'reason',
                'zoomHint',
                'transitionHint',
                'speedFactor',
                'energyScore',
              ],
            },
          },
        },
        required: [
          'gameTitle',
          'captureSource',
          'summary',
          'detectedLanguage',
          'suggestedStyle',
          'highlights',
          'segments',
        ],
      },
    },
  }),
    ['gemini-3.1-flash-lite'],
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    gameTitle?: string;
    captureSource?: string;
    summary?: string;
    detectedLanguage?: string;
    suggestedStyle?: string;
    highlights?: Array<{
      startSec: number;
      endSec: number;
      title: string;
      reason: string;
      eventType?: string;
    }>;
    segments?: Array<{
      startSec: number;
      endSec: number;
      action: string;
      category: string;
      label: string;
      reason: string;
      zoomHint: string;
      transitionHint: string;
      speedFactor?: number;
      energyScore: number;
    }>;
  };

  const validStyles = new Set<EditingStyleId>([
    'clutch-montage',
    'boss-epic',
    'funny-fails',
    'pro-esports',
    'youtube-letsplay',
  ]);
  const suggestedStyle = validStyles.has(parsed.suggestedStyle as EditingStyleId)
    ? (parsed.suggestedStyle as EditingStyleId)
    : 'clutch-montage';

  const validCapture = new Set(['mobile-screen', 'camera-gameplay', 'pc-console']);
  const captureSource = validCapture.has(parsed.captureSource || '')
    ? (parsed.captureSource as 'mobile-screen' | 'camera-gameplay' | 'pc-console')
    : 'mobile-screen';

  const validEventTypes = new Set<GamingEventType>([
    'kill',
    'headshot',
    'boss-fight',
    'enemy-fight',
    'victory',
    'defeat',
    'clutch',
  ]);

  return {
    gameTitle: parsed.gameTitle || 'Mobile Gameplay Session',
    captureSource,
    analysisSource: 'cloud-gemini',
    summary: parsed.summary || 'Gameplay analyzed for kills, fights, and highlight cuts.',
    detectedLanguage: parsed.detectedLanguage || 'English',
    suggestedStyle,
    highlights: (parsed.highlights || []).slice(0, 14).map((h) => ({
      startSec: Number(h.startSec) || 0,
      endSec: Number(h.endSec) || 0,
      title: h.title || 'Gameplay Highlight',
      reason: h.reason || 'Key combat event',
      eventType: validEventTypes.has(h.eventType as GamingEventType)
        ? (h.eventType as GamingEventType)
        : 'kill',
    })),
    segments: normalizeSegments(parsed.segments || [], durationSec),
    analyzedAt: new Date().toISOString(),
  };
}

const SCRIPT_STYLE_INSTRUCTIONS: Record<ScriptStyleId, string> = {
  'pro-gaming':
    'Professional esports analyst & pro player breakdown: crisp callouts, positioning analysis, recoil/aim precision, and clutch decision-making.',
  'funny-gaming':
    'Hilarious gaming commentary: witty roasts on missed shots or enemy panics, meme-energy punchlines, and playful banter.',
  'epic-gaming':
    'Epic cinematic gaming narration: intense boss-fight stakes, dramatic slow-motion build-up, and heroic victory delivery.',
  'storytelling-gaming':
    'Narrative gaming storytelling: set the survival/match story from hot-drop tension to final circle triumph or heartbreaking defeat.',
  'youtube-commentary':
    'High-retention YouTube gaming creator commentary: energetic intro hook, direct audience callouts ("drop a like if that headshot landed!"), and fast pacing.',
};

export async function generateScriptWithGemini(
  project: ProjectData,
  videoPath: string,
  style: ScriptStyleId,
  language: ScriptLanguage,
  options?: { appendAfterSec?: number; existingCount?: number },
): Promise<{
  scriptTitle: string;
  scriptSummary: string;
  sentences: ScriptSentence[];
}> {
  const ai = getGeminiClient();
  const fileRef = await ensureGeminiVideoFile(project.id, videoPath, 'video/mp4');

  const keptSegments = (project.analysis?.segments || []).filter((s) => s.action === 'keep');
  const keptDuration =
    keptSegments.reduce((sum, s) => sum + (s.endSec - s.startSec) / (s.speedFactor || 1), 0) ||
    project.metadata.durationSec;

  const isAppend = typeof options?.appendAfterSec === 'number';
  const startWindow = isAppend ? options!.appendAfterSec! : 0;
  const remainingSec = Math.max(2, keptDuration - startWindow);
  const targetSentences = Math.max(4, Math.min(60, Math.round(remainingSec / 3.2)));

  const languageDirective =
    language === 'hi'
      ? 'Write EVERY spoken commentary sentence in natural, energetic Hindi using Devanagari script (e.g., "भाई क्या ही तगड़ा हेडशॉट लगा है!"). Make it sound like an authentic Indian gaming YouTuber.'
      : 'Write EVERY spoken commentary sentence in crisp, energetic gaming English suitable for YouTube gameplay commentary.';

  const keptSummary =
    keptSegments.length > 0
      ? keptSegments
          .map(
            (s, i) =>
              `Event ${i + 1} [${s.category}] (${s.startSec.toFixed(1)}s-${s.endSec.toFixed(1)}s, speed ${s.speedFactor}x): ${s.label} — ${s.reason}`,
          )
          .join('\n')
      : `Full gameplay (${project.metadata.durationSec.toFixed(1)}s)`;

  const prompt = `Watch the uploaded gameplay video and write a commentary script synchronized to the actual gameplay events (kills, headshots, enemy fights, boss fights, victory/defeat).
Commentary Style: ${style.toUpperCase()} — ${SCRIPT_STYLE_INSTRUCTIONS[style]}
Language Requirement: ${languageDirective}
${
  isAppend
    ? `Continue the commentary starting after ${startWindow.toFixed(1)}s in the edited gameplay up to ${keptDuration.toFixed(1)}s.`
    : `Cover the edited gameplay timeline from 0.0s to ${keptDuration.toFixed(1)}s with approximately ${targetSentences} commentary lines.`
}

Active Gameplay Events Reference:
${keptSummary}

Rules:
- Each sentence must be speakable (7 to 22 words), directly reacting to what happens on screen.
- Keep startSec and endSec strictly increasing within 0 to ${keptDuration.toFixed(1)}s.
- Include speakerTone (e.g., "Hype", "Shocked", "Tactical", "Funny", "Dramatic").`;

  const response = await withGeminiRetry(
    (modelOverride) =>
      ai.models.generateContent({
        model: modelOverride || 'gemini-4-hydrogen',
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: fileRef.uri,
              mimeType: fileRef.mimeType,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction:
        'You are an expert gaming commentary scriptwriter. Output strict JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scriptTitle: { type: Type.STRING },
          scriptSummary: { type: Type.STRING },
          sentences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sceneIndex: { type: Type.INTEGER },
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                text: { type: Type.STRING },
                speakerTone: { type: Type.STRING },
              },
              required: ['sceneIndex', 'startSec', 'endSec', 'text', 'speakerTone'],
            },
          },
        },
        required: ['scriptTitle', 'scriptSummary', 'sentences'],
      },
    },
  }),
    ['gemini-3.1-flash-lite'],
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    scriptTitle?: string;
    scriptSummary?: string;
    sentences?: Array<{
      sceneIndex: number;
      startSec: number;
      endSec: number;
      text: string;
      speakerTone: string;
    }>;
  };

  const baseIdx = options?.existingCount ?? 0;
  const sentences: ScriptSentence[] = (parsed.sentences || [])
    .filter((s) => s.text && s.text.trim().length > 0)
    .map((s, i) => ({
      id: crypto.randomUUID(),
      sceneIndex: Number(s.sceneIndex) || baseIdx + i + 1,
      startSec: Math.max(0, Math.round((Number(s.startSec) || i * 3) * 100) / 100),
      endSec: Math.max(
        (Number(s.startSec) || i * 3) + 0.8,
        Math.round((Number(s.endSec) || (i + 1) * 3) * 100) / 100,
      ),
      text: s.text.trim(),
      speakerTone: (s.speakerTone || 'Hype').trim(),
      voiceStatus: 'idle',
    }));

  return {
    scriptTitle: parsed.scriptTitle || `${project.title} — Gaming Commentary`,
    scriptSummary: parsed.scriptSummary || 'Gameplay-synced AI commentary script.',
    sentences,
  };
}

export async function generateVoiceOverWav(
  text: string,
  voiceSettings: VoiceSettings,
  speakerTone?: string,
): Promise<Buffer> {
  const ai = getGeminiClient('v1beta');

  const langLabel = voiceSettings.language === 'hi' ? 'Hindi' : 'English';
  const speedLabel =
    voiceSettings.speakingSpeed <= 0.9
      ? 'slow, dramatic pace'
      : voiceSettings.speakingSpeed >= 1.2
        ? 'fast, rapid-fire clutch pace'
        : voiceSettings.speakingSpeed >= 1.08
          ? 'brisk, energetic pace'
          : 'natural commentary pace';

  const styleMap: Record<VoiceSettings['voiceStyle'], string> = {
    natural: 'Natural, engaging gaming YouTuber narration',
    'hype-caster': 'High-energy esports caster shouting clutch highlights',
    'funny-roaster': 'Playful, witty gaming comedian reacting to gameplay',
    'epic-narrator': 'Deep, dramatic cinematic boss-battle narrator',
    'pro-analyst': 'Sharp, tactical pro player breakdown',
  };

  const styleDirective = `${langLabel} gaming commentary voice-over. ${styleMap[voiceSettings.voiceStyle]}. Emotion: ${
    speakerTone || 'Hype'
  }. Speaking speed: ${speedLabel}.`;

  const model = voiceSettings.expressiveMode
    ? 'gemini-3.8-flash-tts'
    : 'gemini-3.8-flash-lite-tts';

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: text.trim(),
            speechMetadata: {
              style: styleDirective,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceSettings.voiceId,
          },
        },
      },
    },
  }));

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64Audio) {
    throw new Error('Gemini TTS returned no audio data for this commentary line.');
  }

  return Buffer.from(base64Audio, 'base64');
}
