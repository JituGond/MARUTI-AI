import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Music, Pause, Play, Sliders, Sparkles } from 'lucide-react';
import type {
  BgmTrackOption,
  EditingSettings,
  EditingStyleId,
  ProjectData,
  VisualEffectId,
} from '../types';
import {
  downloadOfflineMusicPack,
  getCachedBgmTrackIds,
  getOfflineBgmUrl,
} from '../utils/offlineStore';

interface EditStylePanelProps {
  project: ProjectData;
  bgmCatalog: BgmTrackOption[];
  isOnline: boolean;
  onUpdateEditing: (patch: Partial<EditingSettings>) => void;
}

const GAMING_STYLE_PRESETS: Array<{
  id: EditingStyleId;
  name: string;
  desc: string;
  config: Partial<EditingSettings>;
}> = [
  {
    id: 'clutch-montage',
    name: 'Clutch Montage',
    desc: 'Flash impacts, dynamic kill-zooms, slow-mo finishers & Boss Rush EDM.',
    config: {
      styleId: 'clutch-montage',
      transitionType: 'flash',
      zoomIntensity: 'dynamic',
      visualEffect: 'killcam-contrast',
      slowMoOnHighlights: true,
      enhanceColor: true,
      bgmTrackId: 'boss-rush-edm',
      bgmVolume: 0.18,
    },
  },
  {
    id: 'boss-epic',
    name: 'Epic Boss Battle',
    desc: 'Dramatic dip-to-black fades, slow-motion boss kills & 808 trap beat.',
    config: {
      styleId: 'boss-epic',
      transitionType: 'dip-black',
      zoomIntensity: 'subtle',
      visualEffect: 'cinematic-vignette',
      slowMoOnHighlights: true,
      enhanceColor: true,
      bgmTrackId: 'clutch-trap',
      bgmVolume: 0.2,
    },
  },
  {
    id: 'funny-fails',
    name: 'Funny Gameplay & Fails',
    desc: 'Snappy jump cuts, punch-in meme zooms & arcade bounce soundtrack.',
    config: {
      styleId: 'funny-fails',
      transitionType: 'none',
      zoomIntensity: 'dynamic',
      visualEffect: 'none',
      slowMoOnHighlights: false,
      enhanceColor: false,
      bgmTrackId: 'funny-meme',
      bgmVolume: 0.18,
    },
  },
  {
    id: 'pro-esports',
    name: 'Pro Esports Breakdown',
    desc: 'High-clarity Neon Arena contrast, clean cuts & tactical lo-fi bed.',
    config: {
      styleId: 'pro-esports',
      transitionType: 'crossfade',
      zoomIntensity: 'subtle',
      visualEffect: 'neon-arena',
      slowMoOnHighlights: true,
      enhanceColor: true,
      bgmTrackId: 'chill-lobby',
      bgmVolume: 0.12,
    },
  },
  {
    id: 'youtube-letsplay',
    name: "YouTube Let's Play",
    desc: 'Balanced crossfades, ducked game audio & uplifting victory anthem.',
    config: {
      styleId: 'youtube-letsplay',
      transitionType: 'crossfade',
      zoomIntensity: 'subtle',
      visualEffect: 'killcam-contrast',
      slowMoOnHighlights: true,
      enhanceColor: true,
      bgmTrackId: 'victory-anthem',
      bgmVolume: 0.16,
    },
  },
];

export const EditStylePanel: React.FC<EditStylePanelProps> = ({
  project,
  bgmCatalog,
  isOnline,
  onUpdateEditing,
}) => {
  const { editing } = project;
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<string[]>([]);
  const [isDownloadingMusic, setIsDownloadingMusic] = useState(false);

  useEffect(() => {
    void getCachedBgmTrackIds().then(setCachedTrackIds);
  }, []);

  const handleDownloadPack = async () => {
    setIsDownloadingMusic(true);
    try {
      const ids = await downloadOfflineMusicPack(bgmCatalog);
      setCachedTrackIds(ids);
    } finally {
      setIsDownloadingMusic(false);
    }
  };

  const toggleBgmPreview = async (track: BgmTrackOption) => {
    const audio = previewAudioRef.current;
    if (!audio || !track.url) return;

    if (previewingId === track.id) {
      audio.pause();
      setPreviewingId(null);
      return;
    }

    const offlineUrl = await getOfflineBgmUrl(track.id);
    audio.src = offlineUrl || track.url;
    audio.volume = 0.5;
    void audio.play().then(() => setPreviewingId(track.id)).catch(() => {});
  };

  const downloadableCount = bgmCatalog.filter((t) => t.id !== 'none').length;
  const allCached = downloadableCount > 0 && cachedTrackIds.length >= downloadableCount;

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            02. AI Gaming Editing & Effects
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Works 100% offline. Apply zoom, slow motion, visual grading & gaming music.
          </p>
        </div>
      </div>

      {/* Gaming Style Presets */}
      <div className="space-y-2.5">
        <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          Gaming Montage & Edit Style
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {GAMING_STYLE_PRESETS.map((preset) => {
            const active = editing.styleId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onUpdateEditing(preset.config)}
                className={`min-h-[60px] text-left p-3 rounded-xl border transition-colors ${
                  active
                    ? 'bg-blue-500/15 border-blue-500 text-white'
                    : 'bg-[#0A0F18] border-slate-800 hover:border-slate-700 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{preset.name}</span>
                  {active && (
                    <span className="text-[11px] font-medium text-emerald-400">Active</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-snug">{preset.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Effects, Transitions, Slow-Mo, Audio Mix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 block">
            Combat Transition Effect
          </label>
          <select
            value={editing.transitionType}
            onChange={(e) =>
              onUpdateEditing({
                transitionType: e.target.value as EditingSettings['transitionType'],
              })
            }
            className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="none">Direct Jump Cut</option>
            <option value="flash">Kill-Impact Flash</option>
            <option value="crossfade">Smooth Crossfade</option>
            <option value="dip-black">Dip to Black</option>
            <option value="slide">Whip Slide</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 block">
            Gaming Visual Filter
          </label>
          <select
            value={editing.visualEffect}
            onChange={(e) =>
              onUpdateEditing({ visualEffect: e.target.value as VisualEffectId })
            }
            className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="none">Natural Gameplay</option>
            <option value="killcam-contrast">Kill-Cam Contrast & Sharpen</option>
            <option value="neon-arena">Neon Arena Saturation</option>
            <option value="cinematic-vignette">Boss Cinematic Vignette</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 block">
            Highlight Zoom Intensity
          </label>
          <select
            value={editing.zoomIntensity}
            onChange={(e) =>
              onUpdateEditing({
                zoomIntensity: e.target.value as EditingSettings['zoomIntensity'],
              })
            }
            className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="off">Off (1.00x Static)</option>
            <option value="subtle">Subtle (1.06x Focus)</option>
            <option value="dynamic">Dynamic (1.12x Kill Zoom)</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 block">
            Game Audio Mixing
          </label>
          <select
            value={editing.originalAudioMode}
            onChange={(e) =>
              onUpdateEditing({
                originalAudioMode: e.target.value as EditingSettings['originalAudioMode'],
              })
            }
            className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-700 rounded-xl px-3 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="duck">Duck Game Audio Under Voice</option>
            <option value="mix">Full Game SFX Volume</option>
            <option value="mute">Mute Game Audio (Voice Only)</option>
          </select>
        </div>

        <label className="min-h-[44px] px-3 py-2 rounded-xl bg-[#0A0F18] border border-slate-800 flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-xs font-medium text-slate-200">
            Slow-Motion on Kill Highlights
          </span>
          <input
            type="checkbox"
            checked={editing.slowMoOnHighlights}
            onChange={(e) => onUpdateEditing({ slowMoOnHighlights: e.target.checked })}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>

        <label className="min-h-[44px] px-3 py-2 rounded-xl bg-[#0A0F18] border border-slate-800 flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-xs font-medium text-slate-200">
            Show Commentary Captions
          </span>
          <input
            type="checkbox"
            checked={editing.autoCaptions}
            onChange={(e) => onUpdateEditing({ autoCaptions: e.target.checked })}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>
      </div>

      {/* Offline Gaming Music Library */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-blue-400" />
            Gaming Background Music
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleDownloadPack()}
              disabled={isDownloadingMusic || !isOnline || allCached}
              className="min-h-[36px] px-3 py-1 rounded-lg bg-[#0A0F18] border border-slate-700 hover:border-emerald-500/60 disabled:opacity-60 text-xs font-medium text-slate-200 flex items-center gap-1.5"
            >
              {allCached ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Saved Offline ({cachedTrackIds.length}/{downloadableCount})
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  {isDownloadingMusic ? 'Caching...' : 'Download Music Offline'}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5" />
            Music Volume: <strong className="font-mono tabular-nums text-slate-200">{Math.round(editing.bgmVolume * 100)}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.02}
            value={editing.bgmVolume}
            onChange={(e) => onUpdateEditing({ bgmVolume: Number(e.target.value) })}
            aria-label="Gaming background music volume"
            className="w-36 accent-blue-500"
          />
        </div>

        <div className="space-y-2">
          {bgmCatalog.map((track) => {
            const selected = editing.bgmTrackId === track.id;
            const isPreviewing = previewingId === track.id;
            const isCached = cachedTrackIds.includes(track.id);
            return (
              <div
                key={track.id}
                onClick={() => onUpdateEditing({ bgmTrackId: track.id })}
                className={`min-h-[48px] px-3 py-2 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  selected
                    ? 'bg-emerald-500/10 border-emerald-500/70'
                    : 'bg-[#0A0F18] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {track.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {track.mood}
                    {track.bpm > 0 ? ` · ${track.bpm} BPM` : ''}
                    {isCached ? ' · Offline Ready' : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {track.url && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleBgmPreview(track);
                      }}
                      aria-label={isPreviewing ? `Stop ${track.name}` : `Preview ${track.name}`}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                    >
                      {isPreviewing ? (
                        <Pause className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <span
                    className={`text-xs font-medium ${
                      selected ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {selected ? 'Active' : 'Use'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <audio
          ref={previewAudioRef}
          onEnded={() => setPreviewingId(null)}
          className="hidden"
        />
      </div>
    </div>
  );
};
