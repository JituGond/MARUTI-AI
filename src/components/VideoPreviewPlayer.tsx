import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { BgmTrackOption, ProjectData, TimelineSegment } from '../types';
import { getOfflineBgmUrl, getVoiceClipOffline } from '../utils/offlineStore';
import { formatTimecode } from '../utils/format';

interface VideoPreviewPlayerProps {
  project: ProjectData;
  bgmCatalog: BgmTrackOption[];
  currentTimeSec: number;
  onTimeChange: (sec: number) => void;
  seekRequestSec: { sec: number; nonce: number } | null;
}

export const VideoPreviewPlayer: React.FC<VideoPreviewPlayerProps> = ({
  project,
  bgmCatalog,
  currentTimeSec,
  onTimeChange,
  seekRequestSec,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [previewMode, setPreviewMode] = useState<'edited' | 'original'>('edited');
  const [transitionPulse, setTransitionPulse] = useState(false);
  const [resolvedBgmUrl, setResolvedBgmUrl] = useState<string>('');
  const lastPlayedVoiceIdRef = useRef<string | null>(null);
  const lastSegIdRef = useRef<string | null>(null);

  const keptSegments = useMemo<TimelineSegment[]>(() => {
    const segs = project.analysis?.segments ?? [];
    const kept = segs
      .filter((s) => s.action === 'keep' && s.endSec - s.startSec >= 0.15)
      .sort((a, b) => a.startSec - b.startSec);
    if (kept.length > 0) return kept;
    return [
      {
        id: 'full',
        startSec: 0,
        endSec: Math.max(project.metadata.durationSec, 0.5),
        action: 'keep',
        category: 'team-fight',
        label: 'Full Gameplay',
        reason: 'Full source gameplay',
        zoomHint: 'none',
        transitionHint: 'cut',
        speedFactor: 1,
        energyScore: 70,
      },
    ];
  }, [project.analysis?.segments, project.metadata.durationSec]);

  const totalEditedDuration = useMemo(
    () =>
      keptSegments.reduce(
        (acc, s) =>
          acc +
          (s.endSec - s.startSec) /
            (project.editing.slowMoOnHighlights ? s.speedFactor || 1 : 1),
        0,
      ),
    [keptSegments, project.editing.slowMoOnHighlights],
  );

  const editedTimeSec = useMemo(() => {
    if (previewMode === 'original') return currentTimeSec;
    let acc = 0;
    for (const seg of keptSegments) {
      const spd = project.editing.slowMoOnHighlights ? seg.speedFactor || 1 : 1;
      if (currentTimeSec >= seg.endSec) {
        acc += (seg.endSec - seg.startSec) / spd;
      } else if (currentTimeSec >= seg.startSec) {
        acc += (currentTimeSec - seg.startSec) / spd;
        break;
      } else {
        break;
      }
    }
    return acc;
  }, [currentTimeSec, keptSegments, previewMode, project.editing.slowMoOnHighlights]);

  const activeSegment = useMemo(() => {
    const list = project.analysis?.segments ?? keptSegments;
    return (
      list.find((s) => currentTimeSec >= s.startSec && currentTimeSec < s.endSec) ||
      keptSegments[0]
    );
  }, [project.analysis?.segments, keptSegments, currentTimeSec]);

  const activeSentence = useMemo(() => {
    const timeToMatch = previewMode === 'edited' ? editedTimeSec : currentTimeSec;
    return (
      project.sentences.find(
        (s) => timeToMatch >= s.startSec && timeToMatch < Math.max(s.endSec, s.startSec + 0.5),
      ) || null
    );
  }, [project.sentences, editedTimeSec, currentTimeSec, previewMode]);

  const bgmTrack = useMemo(
    () => bgmCatalog.find((t) => t.id === project.editing.bgmTrackId) || null,
    [bgmCatalog, project.editing.bgmTrackId],
  );

  // Prefer offline cached BGM blob if downloaded, fallback to server URL
  useEffect(() => {
    let activeUrlToRevoke: string | null = null;
    let cancelled = false;
    async function resolveBgm() {
      if (!bgmTrack || bgmTrack.id === 'none') {
        setResolvedBgmUrl('');
        return;
      }
      const offlineUrl = await getOfflineBgmUrl(bgmTrack.id);
      if (cancelled) {
        if (offlineUrl) URL.revokeObjectURL(offlineUrl);
        return;
      }
      if (offlineUrl) {
        activeUrlToRevoke = offlineUrl;
        setResolvedBgmUrl(offlineUrl);
      } else {
        setResolvedBgmUrl(bgmTrack.url);
      }
    }
    void resolveBgm();
    return () => {
      cancelled = true;
      if (activeUrlToRevoke) URL.revokeObjectURL(activeUrlToRevoke);
    };
  }, [bgmTrack]);

  useEffect(() => {
    if (!seekRequestSec || !videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(project.metadata.durationSec, seekRequestSec.sec),
    );
    onTimeChange(videoRef.current.currentTime);
    lastPlayedVoiceIdRef.current = null;
  }, [seekRequestSec, project.metadata.durationSec, onTimeChange]);

  // Apply live slow-motion playbackRate on active segment
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (previewMode === 'edited' && project.editing.slowMoOnHighlights && activeSegment) {
      vid.playbackRate = Math.max(0.5, Math.min(1.5, activeSegment.speedFactor || 1));
    } else {
      vid.playbackRate = 1;
    }
  }, [previewMode, project.editing.slowMoOnHighlights, activeSegment]);

  // Sync BGM
  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : Math.max(0, Math.min(1, project.editing.bgmVolume));
    if (isPlaying && previewMode === 'edited' && resolvedBgmUrl) {
      if (audio.paused) {
        void audio.play().catch(() => {});
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [isPlaying, previewMode, project.editing.bgmVolume, isMuted, resolvedBgmUrl]);

  // Sync original game audio ducking
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isMuted) {
      vid.muted = true;
      return;
    }
    if (previewMode === 'original') {
      vid.muted = false;
      vid.volume = 1;
      return;
    }
    if (project.editing.originalAudioMode === 'mute') {
      vid.muted = true;
    } else if (project.editing.originalAudioMode === 'duck' && activeSentence?.audioUrl) {
      vid.muted = false;
      vid.volume = 0.25;
    } else {
      vid.muted = false;
      vid.volume = 1;
    }
  }, [isMuted, previewMode, project.editing.originalAudioMode, activeSentence?.audioUrl]);

  // Sync voice-over playback (supports offline IndexedDB voice blob fallback!)
  useEffect(() => {
    const vo = voiceRef.current;
    if (!vo) return;

    if (!isPlaying || previewMode !== 'edited' || isMuted || !activeSentence) {
      if (!isPlaying && !vo.paused) {
        vo.pause();
      }
      return;
    }

    if (lastPlayedVoiceIdRef.current !== activeSentence.id && (activeSentence.audioUrl || activeSentence.voiceStatus === 'ready')) {
      lastPlayedVoiceIdRef.current = activeSentence.id;
      void (async () => {
        const offlineBlob = await getVoiceClipOffline(project.id, activeSentence.id);
        const src = offlineBlob ? URL.createObjectURL(offlineBlob) : activeSentence.audioUrl || '';
        if (!src) return;
        vo.src = src;
        vo.playbackRate = Math.max(0.75, Math.min(1.5, project.voiceSettings.speakingSpeed || 1));
        vo.volume = 1;
        void vo.play().catch(() => {});
      })();
    }
  }, [activeSentence, isPlaying, previewMode, isMuted, project.id, project.voiceSettings.speakingSpeed]);

  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const t = vid.currentTime;

    if (previewMode === 'edited' && keptSegments.length > 0) {
      const inKept = keptSegments.find((s) => t >= s.startSec - 0.05 && t < s.endSec);
      if (!inKept) {
        const nextKept = keptSegments.find((s) => s.startSec > t);
        if (nextKept) {
          vid.currentTime = nextKept.startSec;
          onTimeChange(nextKept.startSec);
          if (project.editing.transitionType !== 'none') {
            setTransitionPulse(true);
            setTimeout(() => setTransitionPulse(false), 160);
          }
          return;
        } else {
          vid.pause();
          setIsPlaying(false);
          const first = keptSegments[0];
          vid.currentTime = first.startSec;
          onTimeChange(first.startSec);
          lastPlayedVoiceIdRef.current = null;
          return;
        }
      } else if (lastSegIdRef.current && lastSegIdRef.current !== inKept.id) {
        if (project.editing.transitionType !== 'none') {
          setTransitionPulse(true);
          setTimeout(() => setTransitionPulse(false), 160);
        }
      }
      lastSegIdRef.current = inKept.id;
    }

    onTimeChange(t);
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      if (previewMode === 'edited' && keptSegments.length > 0) {
        const currentInKept = keptSegments.some(
          (s) => vid.currentTime >= s.startSec && vid.currentTime < s.endSec - 0.1,
        );
        if (!currentInKept) {
          vid.currentTime = keptSegments[0].startSec;
        }
      }
      void vid.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      setIsPlaying(false);
      if (voiceRef.current && !voiceRef.current.paused) {
        voiceRef.current.pause();
      }
    }
  };

  const jumpSegment = (dir: -1 | 1) => {
    const vid = videoRef.current;
    if (!vid || keptSegments.length === 0) return;
    const idx = keptSegments.findIndex(
      (s) => vid.currentTime >= s.startSec - 0.1 && vid.currentTime < s.endSec,
    );
    const targetIdx =
      idx === -1 ? 0 : Math.max(0, Math.min(keptSegments.length - 1, idx + dir));
    vid.currentTime = keptSegments[targetIdx].startSec;
    onTimeChange(keptSegments[targetIdx].startSec);
    lastPlayedVoiceIdRef.current = null;
  };

  const computeVideoScale = (): string => {
    if (previewMode !== 'edited' || project.editing.zoomIntensity === 'off') {
      return 'scale(1)';
    }
    if (!activeSegment || activeSegment.zoomHint === 'none') {
      return 'scale(1)';
    }
    const factor = project.editing.zoomIntensity === 'dynamic' ? 1.12 : 1.06;
    return `scale(${factor})`;
  };

  const computeVideoFilter = (): string => {
    if (previewMode !== 'edited') return 'none';
    if (project.editing.visualEffect === 'neon-arena') {
      return 'contrast(1.1) saturate(1.26) brightness(1.03)';
    }
    if (project.editing.visualEffect === 'killcam-contrast' || project.editing.enhanceColor) {
      return 'contrast(1.08) saturate(1.15) brightness(1.02)';
    }
    if (project.editing.visualEffect === 'cinematic-vignette') {
      return 'contrast(1.06) saturate(1.08)';
    }
    return 'none';
  };

  const isCurrentlyCut = activeSegment?.action === 'cut';
  const activeSpeed =
    previewMode === 'edited' && project.editing.slowMoOnHighlights
      ? activeSegment?.speedFactor || 1
      : 1;

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden">
      {/* Mode bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/80 bg-[#0E1524]">
        <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
          <span className="font-medium text-slate-200 truncate max-w-[180px] sm:max-w-xs">
            {project.title}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums shrink-0">
            {project.metadata.width}x{project.metadata.height}
          </span>
          {activeSpeed !== 1 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-blue-400 shrink-0">
                {activeSpeed}x
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 p-0.5 bg-[#0A0F18] border border-slate-800 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setPreviewMode('edited')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              previewMode === 'edited'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            Edited Cut
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode('original')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              previewMode === 'original'
                ? 'bg-blue-500 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            Raw Match
          </button>
        </div>
      </div>

      {/* Gameplay Stage */}
      <div className="relative aspect-video bg-black overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          src={project.videoUrl}
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => {
            setIsPlaying(false);
            lastPlayedVoiceIdRef.current = null;
          }}
          onClick={togglePlay}
          className="w-full h-full object-contain transition-transform duration-500 ease-out cursor-pointer"
          style={{
            transform: computeVideoScale(),
            filter: computeVideoFilter(),
            opacity: transitionPulse
              ? project.editing.transitionType === 'flash'
                ? 0.2
                : 0.55
              : 1,
          }}
        />

        {previewMode === 'edited' && project.editing.visualEffect === 'cinematic-vignette' && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)',
            }}
          />
        )}

        {previewMode === 'original' && isCurrentlyCut && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-rose-500/90 text-white text-xs font-semibold flex items-center gap-1.5 pointer-events-none">
            <Scissors className="w-3.5 h-3.5" />
            Marked Cut: {activeSegment?.label}
          </div>
        )}

        {previewMode === 'edited' && project.editing.autoCaptions && activeSentence && (
          <div className="absolute inset-x-0 bottom-0 pt-10 pb-4 px-4 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none flex justify-center">
            <p className="max-w-xl text-center text-sm sm:text-base font-semibold text-white leading-snug drop-shadow">
              {activeSentence.text}
            </p>
          </div>
        )}

        {resolvedBgmUrl ? <audio ref={bgmRef} src={resolvedBgmUrl} loop preload="auto" /> : null}
        <audio ref={voiceRef} preload="auto" />
      </div>

      {/* Transport Controls */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#0E1524] border-t border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => jumpSegment(-1)}
            aria-label="Previous kept highlight"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause gameplay' : 'Play gameplay'}
            className="min-h-[44px] min-w-[44px] px-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span className="hidden sm:inline">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={() => jumpSegment(1)}
            aria-label="Next kept highlight"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2.5 text-xs font-mono tabular-nums text-slate-300">
          <span>
            {formatTimecode(previewMode === 'edited' ? editedTimeSec : currentTimeSec)}
          </span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">
            {formatTimecode(
              previewMode === 'edited' ? totalEditedDuration : project.metadata.durationSec,
            )}
          </span>
          {activeSentence && (
            <span className="hidden md:inline text-blue-400 font-sans font-medium">
              · Commentary Synced
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-rose-400" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};
