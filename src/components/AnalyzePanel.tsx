import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Cpu,
  Crosshair,
  Loader2,
  PlayCircle,
  Scissors,
  Sparkles,
  Split,
  WifiOff,
} from 'lucide-react';
import type { ProjectData, TimelineSegment, ZoomHint } from '../types';
import { formatTimecode } from '../utils/format';

interface AnalyzePanelProps {
  project: ProjectData;
  isOnline: boolean;
  currentTimeSec: number;
  isAnalyzing: boolean;
  analyzeError: string | null;
  onRunCloudAnalysis: () => void;
  onRunOfflineAnalysis: () => void;
  onUpdateSegments: (segments: TimelineSegment[]) => void;
  onSeek: (sec: number) => void;
}

export const AnalyzePanel: React.FC<AnalyzePanelProps> = ({
  project,
  isOnline,
  currentTimeSec,
  isAnalyzing,
  analyzeError,
  onRunCloudAnalysis,
  onRunOfflineAnalysis,
  onUpdateSegments,
  onSeek,
}) => {
  const [filter, setFilter] = useState<'all' | 'keep' | 'cut'>('all');

  const segments = useMemo<TimelineSegment[]>(() => {
    if (project.analysis?.segments && project.analysis.segments.length > 0) {
      return project.analysis.segments;
    }
    return [
      {
        id: 'manual_base',
        startSec: 0,
        endSec: Math.max(0.5, project.metadata.durationSec),
        action: 'keep',
        category: 'team-fight',
        label: 'Full Gameplay Clip',
        reason: 'Manual timeline ready for offline split & trim',
        zoomHint: 'none',
        transitionHint: 'cut',
        speedFactor: 1,
        energyScore: 70,
      },
    ];
  }, [project.analysis?.segments, project.metadata.durationSec]);

  const filteredSegments = useMemo(() => {
    if (filter === 'all') return segments;
    return segments.filter((s) => s.action === filter);
  }, [segments, filter]);

  const toggleAction = (id: string) => {
    const next = segments.map((s) =>
      s.id === id ? { ...s, action: (s.action === 'keep' ? 'cut' : 'keep') as 'keep' | 'cut' } : s,
    );
    onUpdateSegments(next);
  };

  const updateSegmentField = <K extends keyof TimelineSegment>(
    id: string,
    field: K,
    value: TimelineSegment[K],
  ) => {
    const next = segments.map((s) => (s.id === id ? { ...s, [field]: value } : s));
    onUpdateSegments(next);
  };

  const adjustBound = (id: string, field: 'startSec' | 'endSec', delta: number) => {
    const duration = project.metadata.durationSec;
    const next = segments.map((s) => {
      if (s.id !== id) return s;
      const val = Math.round((s[field] + delta) * 10) / 10;
      if (field === 'startSec') {
        return { ...s, startSec: Math.max(0, Math.min(s.endSec - 0.3, val)) };
      }
      return { ...s, endSec: Math.min(duration, Math.max(s.startSec + 0.3, val)) };
    });
    onUpdateSegments(next);
  };

  const splitAtPlayhead = () => {
    const target = segments.find(
      (s) => currentTimeSec > s.startSec + 0.4 && currentTimeSec < s.endSec - 0.4,
    );
    if (!target) return;
    const splitPoint = Math.round(currentTimeSec * 100) / 100;
    const first: TimelineSegment = {
      ...target,
      endSec: splitPoint,
    };
    const second: TimelineSegment = {
      ...target,
      id: `${target.id}_b_${Date.now()}`,
      startSec: splitPoint,
      label: `${target.label} (Part 2)`,
    };
    const next = segments.flatMap((s) => (s.id === target.id ? [first, second] : [s]));
    onUpdateSegments(next);
  };

  const canSplit = segments.some(
    (s) => currentTimeSec > s.startSec + 0.4 && currentTimeSec < s.endSec - 0.4,
  );

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-100">
          01. AI Gaming Video Analysis & Cuts
        </h2>
        <p className="text-xs text-slate-400">
          Detects kills, headshots, enemy & boss fights, victories, and boring looting pauses.
        </p>
      </div>

      {/* Dual AI Engine Trigger: Cloud Vision (Online) vs On-Device Peak Detector (Offline) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onRunCloudAnalysis}
          disabled={isAnalyzing || !isOnline || project.isLocalOnly}
          className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs sm:text-sm flex flex-col items-center justify-center transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {project.analysis?.analysisSource === 'cloud-gemini'
              ? 'Re-Scan with Cloud AI'
              : 'Cloud Vision AI Scan'}
          </span>
          <span className="text-[10px] font-medium opacity-80 mt-0.5">
            {!isOnline
              ? 'Requires Internet'
              : project.isLocalOnly
                ? 'Offline clip — use On-Device Scan'
                : 'Kills, Headshots & Bosses (Internet)'}
          </span>
        </button>

        <button
          type="button"
          onClick={onRunOfflineAnalysis}
          disabled={isAnalyzing}
          className="min-h-[48px] px-3.5 py-2.5 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/50 disabled:opacity-50 text-blue-200 font-semibold text-xs sm:text-sm flex flex-col items-center justify-center transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-blue-400" />
            On-Device Combat Scan
          </span>
          <span className="text-[10px] font-medium text-blue-300/80 mt-0.5">
            100% Offline Audio Peak AI
          </span>
        </button>
      </div>

      {!isOnline && (
        <div className="p-2.5 rounded-xl bg-[#0A0F18] border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Offline Mode: Use On-Device Combat Scan or manual Split & Trim below. Cloud Vision AI
            requires internet.
          </span>
        </div>
      )}

      {analyzeError && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{analyzeError}</span>
        </div>
      )}

      {isAnalyzing && (
        <div className="p-4 rounded-xl bg-[#0A0F18] border border-blue-900/50 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-blue-300 font-medium">
              Scanning gameplay for kills, fights & dead air...
            </span>
            <span className="font-mono text-slate-400">Up to 15 min</span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-gradient-to-r from-blue-500 to-emerald-400 animate-pulse rounded-full" />
          </div>
        </div>
      )}

      {project.analysis && (
        <div className="p-4 rounded-xl bg-[#0A0F18] border border-slate-800/80 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-emerald-400 font-semibold">{project.analysis.gameTitle}</span>
            <span aria-hidden="true">·</span>
            <span>
              {project.analysis.analysisSource === 'cloud-gemini'
                ? 'Cloud Vision AI'
                : 'On-Device Offline AI'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-blue-400">Style: {project.analysis.suggestedStyle}</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {project.analysis.summary}
          </p>

          {project.analysis.highlights.length > 0 && (
            <div className="pt-2 border-t border-slate-800/70 space-y-2">
              <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                Detected Combat & Match Highlights (Tap to jump)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {project.analysis.highlights.map((hl, idx) => (
                  <button
                    key={`${hl.startSec}-${idx}`}
                    type="button"
                    onClick={() => onSeek(hl.startSec)}
                    className="min-h-[44px] text-left p-2.5 rounded-lg bg-[#111827] hover:bg-slate-800/90 border border-slate-800 transition-colors flex items-start gap-2"
                  >
                    <PlayCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200 truncate">
                        {hl.title}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400">
                        {hl.eventType} · {formatTimecode(hl.startSec)}–{formatTimecode(hl.endSec)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual & AI Segment Review Controls (100% Offline Ready) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-[#0A0F18] border border-slate-800 rounded-lg">
          {(['all', 'keep', 'cut'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === tab
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'all'
                ? `All (${segments.length})`
                : tab === 'keep'
                  ? `Keep (${segments.filter((s) => s.action === 'keep').length})`
                  : `Cut (${segments.filter((s) => s.action === 'cut').length})`}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={splitAtPlayhead}
          disabled={!canSplit}
          className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0A0F18] hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Split className="w-3.5 h-3.5 text-blue-400" />
          Split at {formatTimecode(currentTimeSec)}
        </button>
      </div>

      {/* Segment Cards */}
      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
        {filteredSegments.map((seg) => {
          const isCut = seg.action === 'cut';
          const isCurrent = currentTimeSec >= seg.startSec && currentTimeSec < seg.endSec;

          return (
            <div
              key={seg.id}
              className={`p-3 rounded-xl border transition-colors ${
                isCurrent
                  ? 'bg-[#162235] border-blue-500/60'
                  : 'bg-[#0A0F18] border-slate-800/90 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onSeek(seg.startSec)}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100 truncate">
                      {seg.label}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      · {seg.category} · Intensity {seg.energyScore}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{seg.reason}</p>
                </button>

                <button
                  type="button"
                  onClick={() => toggleAction(seg.id)}
                  className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    isCut
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                  }`}
                >
                  {isCut ? (
                    <>
                      <Scissors className="w-3.5 h-3.5" />
                      Cut
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Keep
                    </>
                  )}
                </button>
              </div>

              {/* Manual Trim + Slow-Mo + Zoom */}
              <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1 font-mono tabular-nums text-slate-300">
                  <button
                    type="button"
                    onClick={() => adjustBound(seg.id, 'startSec', -0.5)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    -0.5s
                  </button>
                  <span>{formatTimecode(seg.startSec)}</span>
                  <button
                    type="button"
                    onClick={() => adjustBound(seg.id, 'startSec', 0.5)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    +0.5s
                  </button>
                  <span className="text-slate-600 px-0.5">→</span>
                  <button
                    type="button"
                    onClick={() => adjustBound(seg.id, 'endSec', -0.5)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    -0.5s
                  </button>
                  <span>{formatTimecode(seg.endSec)}</span>
                  <button
                    type="button"
                    onClick={() => adjustBound(seg.id, 'endSec', 0.5)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    +0.5s
                  </button>
                </div>

                {!isCut && (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={seg.speedFactor || 1}
                      onChange={(e) =>
                        updateSegmentField(seg.id, 'speedFactor', Number(e.target.value))
                      }
                      aria-label="Segment speed slow motion"
                      className="bg-[#111827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                    >
                      <option value={0.5}>0.5x Slow-Mo</option>
                      <option value={0.75}>0.75x Slow-Mo</option>
                      <option value={1}>1.0x Normal</option>
                      <option value={1.25}>1.25x Fast</option>
                    </select>

                    <select
                      value={seg.zoomHint}
                      onChange={(e) =>
                        updateSegmentField(seg.id, 'zoomHint', e.target.value as ZoomHint)
                      }
                      aria-label="Segment zoom"
                      className="bg-[#111827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="none">Zoom: Off</option>
                      <option value="punch-in">Punch-in</option>
                      <option value="slow-zoom">Slow Push</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
