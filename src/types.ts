export type SegmentAction = 'keep' | 'cut';

export type SegmentCategory =
  | 'kill-feed'
  | 'headshot'
  | 'boss-fight'
  | 'team-fight'
  | 'victory'
  | 'defeat'
  | 'clutch'
  | 'looting-boring'
  | 'lobby-wait'
  | 'dead-air'
  | 'repetition';

export type GamingEventType =
  | 'kill'
  | 'headshot'
  | 'boss-fight'
  | 'enemy-fight'
  | 'victory'
  | 'defeat'
  | 'clutch';

export type ZoomHint = 'none' | 'punch-in' | 'slow-zoom';

export type TransitionHint = 'cut' | 'crossfade' | 'whip' | 'flash';

export type EditingStyleId =
  | 'clutch-montage'
  | 'boss-epic'
  | 'funny-fails'
  | 'pro-esports'
  | 'youtube-letsplay';

export type VisualEffectId =
  | 'none'
  | 'killcam-contrast'
  | 'neon-arena'
  | 'cinematic-vignette';

export type ScriptStyleId =
  | 'pro-gaming'
  | 'funny-gaming'
  | 'epic-gaming'
  | 'storytelling-gaming'
  | 'youtube-commentary';

export type ScriptLanguage = 'en' | 'hi';

export type VoiceId = 'Kore' | 'Zephyr' | 'Charon' | 'Fenrir' | 'Puck';

export type ExportPresetId =
  | 'youtube-1080p'
  | 'youtube-720p'
  | 'youtube-shorts'
  | 'audio-master-wav';

export interface VideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  sizeBytes: number;
  fileName: string;
}

export interface TimelineSegment {
  id: string;
  startSec: number;
  endSec: number;
  action: SegmentAction;
  category: SegmentCategory;
  label: string;
  reason: string;
  zoomHint: ZoomHint;
  transitionHint: TransitionHint;
  speedFactor: number;
  energyScore: number;
}

export interface VideoHighlight {
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  eventType: GamingEventType;
}

export interface VideoAnalysisResult {
  gameTitle: string;
  captureSource: 'mobile-screen' | 'camera-gameplay' | 'pc-console';
  analysisSource: 'cloud-gemini' | 'ondevice-audio-peaks';
  summary: string;
  detectedLanguage: string;
  suggestedStyle: EditingStyleId;
  highlights: VideoHighlight[];
  segments: TimelineSegment[];
  analyzedAt: string;
}

export interface EditingSettings {
  styleId: EditingStyleId;
  transitionType: 'none' | 'crossfade' | 'flash' | 'dip-black' | 'slide';
  zoomIntensity: 'off' | 'subtle' | 'dynamic';
  visualEffect: VisualEffectId;
  slowMoOnHighlights: boolean;
  enhanceColor: boolean;
  bgmTrackId: string;
  bgmVolume: number;
  originalAudioMode: 'mix' | 'duck' | 'mute';
  autoCaptions: boolean;
}

export interface ScriptSentence {
  id: string;
  sceneIndex: number;
  startSec: number;
  endSec: number;
  text: string;
  speakerTone: string;
  audioUrl?: string;
  audioDurationSec?: number;
  voiceStatus: 'idle' | 'generating' | 'ready' | 'error';
  voiceError?: string;
}

export interface VoiceSettings {
  language: ScriptLanguage;
  voiceId: VoiceId;
  voiceStyle: 'natural' | 'hype-caster' | 'funny-roaster' | 'epic-narrator' | 'pro-analyst';
  speakingSpeed: number;
  expressiveMode: boolean;
}

export interface ExportJob {
  id: string;
  projectId: string;
  presetId: ExportPresetId;
  label: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  progress: number;
  outputSizeBytes?: number;
  downloadUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ProjectData {
  id: string;
  title: string;
  videoUrl: string;
  thumbnails: string[];
  metadata: VideoMetadata;
  analysis: VideoAnalysisResult | null;
  editing: EditingSettings;
  scriptStyle: ScriptStyleId;
  scriptLanguage: ScriptLanguage;
  scriptTitle: string;
  scriptSummary: string;
  sentences: ScriptSentence[];
  voiceSettings: VoiceSettings;
  masterVoiceUrl?: string;
  exports: ExportJob[];
  isLocalOnly?: boolean;
  createdAt: string;
  lastSavedAt: string;
}

export interface BgmTrackOption {
  id: string;
  name: string;
  mood: string;
  bpm: number;
  url: string;
}
