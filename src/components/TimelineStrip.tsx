import React from 'react';
import { Check, Scissors } from 'lucide-react';
import type { ProjectData, TimelineSegment } from '../types';
import { formatDurationShort } from '../utils/format';

interface TimelineStripProps {
  project: ProjectData;
  currentTimeSec: number;
  onSeek: (sec: number) => void;
  onToggleSegmentAction: (segmentId: string) => void;
}

export const TimelineStrip: React.FC<TimelineStripProps> = ({
  project,
  currentTimeSec,
  onSeek,
  onToggleSegmentAction,
}) => {
  const duration = Math.max(project.metadata.durationSec, 0.5);
  const segments: TimelineSegment[] = project.analysis?.segments ?? [
    {
      id: 'raw',
      startSec: 0,
      endSec: duration,
      action: 'keep',
      category: 'team-fight',
      label: 'Raw Gameplay',
      reason: 'Run AI analysis or split manually to cut boring gameplay',
      zoomHint: 'none',
      transitionHint: 'cut',
      speedFactor: 1,
      energyScore: 65,
    },
  ];

  const keptSec = segments
    .filter((s) => s.action === 'keep')
    .reduce(
      (acc, s) =>
        acc +
        (s.endSec - s.startSec) /
          (project.editing.slowMoOnHighlights ? s.speedFactor || 1 : 1),
      0,
    );
  const cutCount = segments.filter((s) => s.action === 'cut').length;
  const playheadPct = Math.max(0, Math.min(100, (currentTimeSec / duration) * 100));

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 space-y-3">
      {/* Unboxed Timeline Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-200">Gameplay Timeline</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            Raw {formatDurationShort(duration)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-emerald-400 font-medium">
            Edited {formatDurationShort(keptSec)}
          </span>
          {cutCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-rose-400">
                {cutCount} {cutCount === 1 ? 'cut' : 'cuts'}
              </span>
            </>
          )}
        </div>

        <span className="text-[11px] text-slate-500">
          Auto-saved locally · Tap block to seek
        </span>
      </div>

      {/* Filmstrip + Segment Overlay */}
      <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-[#0A0F18] select-none">
        <div className="grid grid-cols-5 sm:grid-cols-10 h-14 opacity-45 pointer-events-none">
          {project.thumbnails.length > 0
            ? project.thumbnails.slice(0, 10).map((url, idx) => (
                <img
                  key={`${url.slice(0, 32)}-${idx}`}
                  src={url}
                  alt={`Gameplay frame ${idx + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover border-r border-slate-900/60 last:border-r-0"
                />
              ))
            : Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className="w-full h-full bg-slate-900/60 border-r border-slate-800/60"
                />
              ))}
        </div>

        <div className="absolute inset-0 flex">
          {segments.map((seg) => {
            const widthPct = Math.max(1.5, ((seg.endSec - seg.startSec) / duration) * 100);
            const isCut = seg.action === 'cut';
            const isActive = currentTimeSec >= seg.startSec && currentTimeSec < seg.endSec;

            return (
              <div
                key={seg.id}
                style={{ width: `${widthPct}%` }}
                onClick={() => onSeek(seg.startSec)}
                title={`${seg.label} (${seg.startSec.toFixed(1)}s - ${seg.endSec.toFixed(1)}s)`}
                className={`group relative h-full border-r border-slate-950/80 last:border-r-0 cursor-pointer transition-colors ${
                  isCut
                    ? 'bg-rose-950/65 hover:bg-rose-900/75'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25'
                } ${isActive ? 'ring-1 ring-inset ring-blue-400' : ''}`}
              >
                <div
                  className={`h-1 w-full ${
                    isCut ? 'bg-rose-500' : 'bg-emerald-400'
                  }`}
                />

                {project.analysis && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSegmentAction(seg.id);
                    }}
                    aria-label={isCut ? `Keep ${seg.label}` : `Cut ${seg.label}`}
                    className={`absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-opacity ${
                      isCut
                        ? 'bg-rose-500/90 text-white'
                        : 'bg-emerald-500/90 text-slate-950 opacity-0 group-hover:opacity-100 focus:opacity-100'
                    }`}
                  >
                    {isCut ? (
                      <>
                        <Scissors className="w-2.5 h-2.5" />
                        Cut
                      </>
                    ) : (
                      <>
                        <Check className="w-2.5 h-2.5" />
                        Keep
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-blue-400 pointer-events-none z-10 shadow-[0_0_8px_rgba(59,130,246,0.9)]"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="w-2.5 h-2.5 -ml-[4px] bg-blue-400 rounded-b-sm" />
        </div>
      </div>
    </div>
  );
};
