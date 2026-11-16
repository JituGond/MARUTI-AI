import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  WifiOff,
} from 'lucide-react';
import type {
  ProjectData,
  ScriptLanguage,
  ScriptSentence,
  ScriptStyleId,
  VoiceId,
  VoiceSettings,
} from '../types';
import { buildOfflineStarterScript } from '../utils/offlineAi';
import { getVoiceClipOffline } from '../utils/offlineStore';
import { formatTimecode } from '../utils/format';

interface ScriptVoicePanelProps {
  project: ProjectData;
  isOnline: boolean;
  isGeneratingScript: boolean;
  scriptError: string | null;
  onGenerateScript: (style: ScriptStyleId, language: ScriptLanguage, append?: boolean) => void;
  onSaveSentences: (sentences: ScriptSentence[], scriptTitle?: string) => void;
  onUpdateVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  onGenerateVoiceBatch: (sentenceIds?: string[], force?: boolean) => Promise<void>;
  onSeek: (sec: number) => void;
}

const GAMING_SCRIPT_STYLES: Array<{ id: ScriptStyleId; label: string }> = [
  { id: 'pro-gaming', label: 'Professional Gaming' },
  { id: 'funny-gaming', label: 'Funny Gaming' },
  { id: 'epic-gaming', label: 'Epic Gaming' },
  { id: 'storytelling-gaming', label: 'Storytelling Gaming' },
  { id: 'youtube-commentary', label: 'YouTube Gaming Commentary' },
];

const VOICE_OPTIONS: Array<{ id: VoiceId; label: string; gender: 'Female' | 'Male'; tone: string }> = [
  { id: 'Fenrir', label: 'Fenrir', gender: 'Male', tone: 'Bold High-Energy Caster' },
  { id: 'Charon', label: 'Charon', gender: 'Male', tone: 'Deep Epic Narrator' },
  { id: 'Puck', label: 'Puck', gender: 'Male', tone: 'Fast Funny Commentator' },
  { id: 'Kore', label: 'Kore', gender: 'Female', tone: 'Clear Studio Pro' },
  { id: 'Zephyr', label: 'Zephyr', gender: 'Female', tone: 'Bright Expressive Gamer' },
];

export const ScriptVoicePanel: React.FC<ScriptVoicePanelProps> = ({
  project,
  isOnline,
  isGeneratingScript,
  scriptError,
  onGenerateScript,
  onSaveSentences,
  onUpdateVoiceSettings,
  onGenerateVoiceBatch,
  onSeek,
}) => {
  const [selectedStyle, setSelectedStyle] = useState<ScriptStyleId>(project.scriptStyle);
  const [selectedLang, setSelectedLang] = useState<ScriptLanguage>(project.scriptLanguage);
  const [isSynthesizingAll, setIsSynthesizingAll] = useState(false);
  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const clipAudioRef = useRef<HTMLAudioElement | null>(null);

  const readyCount = project.sentences.filter((s) => s.voiceStatus === 'ready').length;

  const handleLanguageSwitch = (lang: ScriptLanguage) => {
    setSelectedLang(lang);
    onUpdateVoiceSettings({ language: lang });
  };

  const handleCreateOfflineScript = () => {
    const starter = buildOfflineStarterScript(project, selectedLang);
    onSaveSentences(starter, `${project.title} (Offline Script)`);
  };

  const handleEditSentence = (id: string, patch: Partial<ScriptSentence>) => {
    const next = project.sentences.map((s) => {
      if (s.id !== id) return s;
      const textChanged = typeof patch.text === 'string' && patch.text !== s.text;
      return {
        ...s,
        ...patch,
        voiceStatus: textChanged ? 'idle' : s.voiceStatus,
      };
    });
    onSaveSentences(next);
  };

  const handleAddSentence = () => {
    if (project.sentences.length >= 5000) return;
    const lastEnd =
      project.sentences.length > 0
        ? project.sentences[project.sentences.length - 1].endSec
        : 0;
    const newSentence: ScriptSentence = {
      id: `custom_${Date.now()}`,
      sceneIndex: project.sentences.length + 1,
      startSec: Math.round(lastEnd * 10) / 10,
      endSec: Math.round((lastEnd + 3.5) * 10) / 10,
      text:
        selectedLang === 'hi'
          ? 'भाई क्या ही ज़बरदस्त क्लच शॉट लगा है यहाँ!'
          : 'Insane clutch reaction right there—let us run that back!',
      speakerTone: 'Hype',
      voiceStatus: 'idle',
    };
    onSaveSentences([...project.sentences, newSentence]);
  };

  const handleDeleteSentence = (id: string) => {
    onSaveSentences(project.sentences.filter((s) => s.id !== id));
  };

  const handleSpeakSingle = async (sentence: ScriptSentence) => {
    setVoiceError(null);
    if (!isOnline) {
      // Offline device speech preview fallback
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(sentence.text);
        utter.lang = selectedLang === 'hi' ? 'hi-IN' : 'en-US';
        utter.rate = project.voiceSettings.speakingSpeed || 1;
        window.speechSynthesis.speak(utter);
      } else {
        setVoiceError('Neural AI voice generation requires internet.');
      }
      return;
    }

    setSynthesizingId(sentence.id);
    try {
      await onGenerateVoiceBatch([sentence.id], true);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Voice generation failed.');
    } finally {
      setSynthesizingId(null);
    }
  };

  const handleGenerateAllVoices = async () => {
    setVoiceError(null);
    if (!isOnline) {
      setVoiceError('Cloud Neural TTS requires internet. Connect to synthesize studio WAV files.');
      return;
    }
    setIsSynthesizingAll(true);
    try {
      const pendingIds = project.sentences
        .filter((s) => s.voiceStatus !== 'ready')
        .map((s) => s.id);
      const targets =
        pendingIds.length > 0 ? pendingIds : project.sentences.map((s) => s.id);

      const chunkSize = 6;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        await onGenerateVoiceBatch(chunk, pendingIds.length === 0);
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Batch voice synthesis failed.');
    } finally {
      setIsSynthesizingAll(false);
    }
  };

  const playClip = async (sentence: ScriptSentence) => {
    const audio = clipAudioRef.current;
    if (!audio) return;
    if (playingId === sentence.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    const offlineBlob = await getVoiceClipOffline(project.id, sentence.id);
    const src = offlineBlob ? URL.createObjectURL(offlineBlob) : sentence.audioUrl;
    if (!src) return;
    audio.src = src;
    audio.playbackRate = project.voiceSettings.speakingSpeed || 1;
    void audio.play().then(() => setPlayingId(sentence.id)).catch(() => {});
  };

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-6">
      {/* Section 1: AI Gaming Script Generator */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              03. Gaming Commentary & AI Voice
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Edit scripts offline anytime (up to 5,000 lines). AI script & neural TTS use
              internet.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {project.sentences.length.toLocaleString()} / 5,000 lines
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Commentary Language
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#0A0F18] border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => handleLanguageSwitch('en')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  selectedLang === 'en'
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => handleLanguageSwitch('hi')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  selectedLang === 'hi'
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hindi (हिन्दी)
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Gaming Commentary Style
            </label>
            <select
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value as ScriptStyleId)}
              className="w-full min-h-[48px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {GAMING_SCRIPT_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onGenerateScript(selectedStyle, selectedLang, false)}
            disabled={isGeneratingScript || !isOnline || project.isLocalOnly}
            className="min-h-[44px] flex-1 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            {isGeneratingScript ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Writing Gameplay Script...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {!isOnline
                  ? 'AI Script (Requires Internet)'
                  : project.sentences.length > 0
                    ? 'Regenerate AI Script'
                    : 'Generate AI Gaming Script'}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleCreateOfflineScript}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0A0F18] hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
          >
            Offline Script Template
          </button>

          {project.sentences.length > 0 && project.sentences.length < 5000 && isOnline && !project.isLocalOnly && (
            <button
              type="button"
              onClick={() => onGenerateScript(selectedStyle, selectedLang, true)}
              disabled={isGeneratingScript}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0A0F18] hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              Extend Long Script
            </button>
          )}
        </div>

        {scriptError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{scriptError}</span>
          </div>
        )}
      </div>

      {/* Section 2: Voice-Over Configuration */}
      <div className="pt-4 border-t border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-blue-400" />
            AI Voice-Over ({project.voiceSettings.language === 'hi' ? 'Hindi' : 'English'})
          </span>
          <span className="text-xs font-mono tabular-nums text-emerald-400">
            {readyCount}/{project.sentences.length} voiced
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Male & Female Gaming Voices
            </label>
            <select
              value={project.voiceSettings.voiceId}
              onChange={(e) => onUpdateVoiceSettings({ voiceId: e.target.value as VoiceId })}
              className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.gender}) — {v.tone}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 block">
              Commentary Tone
            </label>
            <select
              value={project.voiceSettings.voiceStyle}
              onChange={(e) =>
                onUpdateVoiceSettings({
                  voiceStyle: e.target.value as VoiceSettings['voiceStyle'],
                })
              }
              className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="hype-caster">Hype Esports Caster</option>
              <option value="natural">Natural YouTube Gamer</option>
              <option value="funny-roaster">Funny Roaster</option>
              <option value="epic-narrator">Epic Boss Narrator</option>
              <option value="pro-analyst">Pro Tactical Analyst</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span>Speed:</span>
            <span className="font-mono tabular-nums text-blue-400">
              {project.voiceSettings.speakingSpeed.toFixed(2)}x
            </span>
            <input
              type="range"
              min={0.85}
              max={1.3}
              step={0.05}
              value={project.voiceSettings.speakingSpeed}
              onChange={(e) =>
                onUpdateVoiceSettings({ speakingSpeed: Number(e.target.value) })
              }
              aria-label="Voice speed"
              className="w-28 accent-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={project.voiceSettings.expressiveMode}
              onChange={(e) =>
                onUpdateVoiceSettings({ expressiveMode: e.target.checked })
              }
              className="w-4 h-4 accent-blue-500"
            />
            Expressive Flash TTS
          </label>
        </div>

        {!isOnline && (
          <div className="p-2.5 rounded-xl bg-[#0A0F18] border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Offline: Script writing & cached voices work offline. Generating new Neural TTS
              requires internet (tap Speak to audition with device speech offline).
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {project.sentences.length > 0 && (
            <button
              type="button"
              onClick={handleGenerateAllVoices}
              disabled={isSynthesizingAll || !isOnline}
              className="min-h-[44px] flex-1 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              {isSynthesizingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Synthesizing Voices...
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  {!isOnline
                    ? 'Neural TTS (Needs Internet)'
                    : readyCount === project.sentences.length
                      ? 'Re-Generate All Voices'
                      : 'Generate All AI Voices'}
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleAddSentence}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0A0F18] hover:bg-slate-800 text-slate-200 text-xs font-medium flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Line (Offline)
          </button>
        </div>

        {voiceError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{voiceError}</span>
          </div>
        )}

        {project.masterVoiceUrl && (
          <div className="p-3 rounded-xl bg-[#0A0F18] border border-emerald-900/50 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-emerald-400">
                Master Commentary Audio Track
              </span>
              <span className="text-slate-400 font-mono tabular-nums">24kHz WAV</span>
            </div>
            <audio controls src={project.masterVoiceUrl} className="w-full h-9" />
          </div>
        )}
      </div>

      {/* Section 3: Editable Commentary Lines (100% Offline Editable) */}
      {project.sentences.length > 0 && (
        <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
          {project.sentences.map((s, idx) => {
            const isBusy = synthesizingId === s.id;
            const isPlayingThis = playingId === s.id;
            return (
              <div
                key={s.id}
                className="p-3 rounded-xl bg-[#0A0F18] border border-slate-800/90 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onSeek(s.startSec)}
                    className="font-mono tabular-nums text-blue-400 hover:underline"
                  >
                    #{idx + 1} · {formatTimecode(s.startSec)}–{formatTimecode(s.endSec)}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">{s.speakerTone}</span>
                    {s.voiceStatus === 'ready' && (
                      <button
                        type="button"
                        onClick={() => void playClip(s)}
                        aria-label={isPlayingThis ? 'Pause clip' : 'Play clip'}
                        className="min-h-[32px] px-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-medium flex items-center gap-1"
                      >
                        {isPlayingThis ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Play
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSpeakSingle(s)}
                      disabled={isBusy || isSynthesizingAll}
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium flex items-center gap-1"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Mic className="w-3 h-3 text-blue-400" />
                      )}
                      {isOnline ? (s.voiceStatus === 'ready' ? 'Re-voice' : 'Speak') : 'Preview'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSentence(s.id)}
                      aria-label="Delete line"
                      className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={s.text}
                  onChange={(e) => handleEditSentence(s.id, { text: e.target.value })}
                  className="w-full bg-[#111827] border border-slate-800 focus:border-blue-500 rounded-lg px-2.5 py-2 text-sm text-slate-100 leading-relaxed focus:outline-none resize-y"
                />

                {s.voiceStatus === 'error' && s.voiceError && (
                  <p className="text-[11px] text-rose-400">{s.voiceError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <audio
        ref={clipAudioRef}
        onEnded={() => setPlayingId(null)}
        className="hidden"
      />
    </div>
  );
};
