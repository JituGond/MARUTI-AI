import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  Film,
  HardDrive,
  Loader2,
  Server,
  Smartphone,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type { ExportPresetId, ProjectData } from '../types';
import { renderOfflineVideoExport } from '../utils/offlineExporter';
import { formatBytes } from '../utils/format';

interface ExportStackPanelProps {
  project: ProjectData;
  isOnline: boolean;
  onStartBatchExport: (presets: ExportPresetId[]) => void;
}

const CLOUD_EXPORT_PRESETS: Array<{
  id: ExportPresetId;
  title: string;
  spec: string;
}> = [
  {
    id: 'youtube-1080p',
    title: 'YouTube Gaming Master (1080p MP4)',
    spec: '1920x1080 · H.264 High · Slow-Mo + Effects + Music + Voice',
  },
  {
    id: 'youtube-720p',
    title: 'Mobile Fast Render (720p MP4)',
    spec: '1280x720 · Rapid H.264 encode for Android sharing',
  },
  {
    id: 'youtube-shorts',
    title: 'Gaming Shorts / Reels (9:16 MP4)',
    spec: '1080x1920 · Vertical auto-framed + blur backdrop',
  },
  {
    id: 'audio-master-wav',
    title: 'Master Commentary Voice Stem (WAV)',
    spec: '24kHz Uncompressed WAV · Ready for external DAWs',
  },
];

export const ExportStackPanel: React.FC<ExportStackPanelProps> = ({
  project,
  isOnline,
  onStartBatchExport,
}) => {
  const [selectedPresets, setSelectedPresets] = useState<ExportPresetId[]>([
    'youtube-1080p',
    'youtube-720p',
  ]);
  const [offlineResolution, setOfflineResolution] = useState<'720p' | '1080p'>('720p');
  const [isOfflineExporting, setIsOfflineExporting] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState('');
  const [offlineDownload, setOfflineDownload] = useState<{
    url: string;
    fileName: string;
    sizeBytes: number;
  } | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  const [calcMinutes, setCalcMinutes] = useState<number>(
    Math.max(1, Math.min(15, Math.ceil(project.metadata.durationSec / 60) || 5)),
  );
  const [calcSentences, setCalcSentences] = useState<number>(
    Math.max(20, project.sentences.length || 120),
  );

  const togglePreset = (id: ExportPresetId) => {
    setSelectedPresets((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const handleOfflineExport = async () => {
    setOfflineError(null);
    setIsOfflineExporting(true);
    setOfflineProgress(2);
    setOfflineStatus('Preparing offline renderer...');

    try {
      const { blob, fileName } = await renderOfflineVideoExport(project, {
        resolution: offlineResolution,
        onProgress: (pct, msg) => {
          setOfflineProgress(pct);
          setOfflineStatus(msg);
        },
      });
      if (offlineDownload?.url) {
        URL.revokeObjectURL(offlineDownload.url);
      }
      const url = URL.createObjectURL(blob);
      setOfflineDownload({ url, fileName, sizeBytes: blob.size });

      // Trigger automatic save to device storage
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setOfflineError(err instanceof Error ? err.message : 'Offline export failed.');
    } finally {
      setIsOfflineExporting(false);
    }
  };

  const videoAnalysisCost = calcMinutes * 0.018;
  const scriptCost = 0.004;
  const ttsCost = calcSentences * 95 * 0.000015;
  const cloudComputeCost = calcMinutes * 0.012;
  const totalEstimatedCost = videoAnalysisCost + scriptCost + ttsCost + cloudComputeCost;

  return (
    <div className="space-y-5">
      {/* 1. 100% Offline On-Device Exporter */}
      <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              Offline On-Device Export (720p / 1080p)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Renders cuts, slow-motion, filters, cached music & voices locally with zero internet.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(['720p', '1080p'] as const).map((res) => (
            <button
              key={res}
              type="button"
              onClick={() => setOfflineResolution(res)}
              className={`min-h-[44px] rounded-xl border text-xs font-semibold transition-colors ${
                offlineResolution === res
                  ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                  : 'bg-[#0A0F18] border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              {res === '720p' ? '720p HD (Fast Mobile)' : '1080p Full HD (YouTube)'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void handleOfflineExport()}
          disabled={isOfflineExporting}
          className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {isOfflineExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {offlineStatus || `Rendering ${offlineProgress}%`}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export {offlineResolution} Video Offline to Device
            </>
          )}
        </button>

        {isOfflineExporting && (
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-200"
              style={{ width: `${Math.max(5, offlineProgress)}%` }}
            />
          </div>
        )}

        {offlineError && (
          <p className="text-xs text-rose-400">{offlineError}</p>
        )}

        {offlineDownload && !isOfflineExporting && (
          <div className="p-3 rounded-xl bg-[#0A0F18] border border-emerald-900/60 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-400 truncate">
                {offlineDownload.fileName}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400">
                {formatBytes(offlineDownload.sizeBytes)} · Ready on device
              </div>
            </div>
            <a
              href={offlineDownload.url}
              download={offlineDownload.fileName}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Save Again
            </a>
          </div>
        )}
      </div>

      {/* 2. Cloud FFmpeg MP4 Batch Export (Requires Internet & Server Upload) */}
      <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Cloud H.264 MP4 Batch Export
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              High-speed server FFmpeg render (requires internet). Queue multiple YouTube formats.
            </p>
          </div>
          {!isOnline && <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-1" />}
        </div>

        <div className="space-y-2">
          {CLOUD_EXPORT_PRESETS.map((preset) => {
            const checked = selectedPresets.includes(preset.id);
            return (
              <label
                key={preset.id}
                className={`min-h-[50px] px-3.5 py-2 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-blue-500/10 border-blue-500/70'
                    : 'bg-[#0A0F18] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100">{preset.title}</div>
                  <div className="text-xs text-slate-400">{preset.spec}</div>
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePreset(preset.id)}
                  className="w-4 h-4 accent-blue-500 shrink-0"
                />
              </label>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onStartBatchExport(selectedPresets)}
          disabled={selectedPresets.length === 0 || !isOnline || project.isLocalOnly}
          className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Film className="w-4 h-4" />
          {!isOnline
            ? 'Cloud MP4 Export (Requires Internet)'
            : project.isLocalOnly
              ? 'Local-Only Clip (Use Offline Export Above)'
              : `Start Cloud MP4 Batch (${selectedPresets.length})`}
        </button>

        {project.exports.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
            <span className="text-xs font-medium text-slate-300 block">Cloud Render Queue</span>
            {project.exports.map((job) => (
              <div
                key={job.id}
                className="p-3 rounded-xl bg-[#0A0F18] border border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {job.label}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>
                        {job.status === 'completed'
                          ? 'Completed'
                          : job.status === 'rendering'
                            ? `Rendering ${job.progress}%`
                            : job.status === 'failed'
                              ? 'Failed'
                              : 'Queued'}
                      </span>
                      {job.outputSizeBytes ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(job.outputSizeBytes)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {job.status === 'completed' && job.downloadUrl && (
                    <a
                      href={job.downloadUrl}
                      download
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                  )}

                  {(job.status === 'queued' || job.status === 'rendering') && (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                  )}
                  {job.status === 'completed' && !job.downloadUrl && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  {job.status === 'failed' && (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                </div>

                {(job.status === 'queued' || job.status === 'rendering') && (
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${Math.max(4, job.progress)}%` }}
                    />
                  </div>
                )}

                {job.status === 'failed' && job.error && (
                  <p className="text-[11px] text-rose-400 leading-snug">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Offline vs Internet Matrix + APIs, Models & Costs */}
      <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Offline vs Internet Matrix, APIs & Cost Calculator
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Transparent breakdown of on-device capabilities, cloud AI models, and unit costs.
          </p>
        </div>

        {/* Offline vs Online Clear Split */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-[#0A0F18] border border-emerald-900/50 space-y-1.5">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              100% Offline Capable
            </div>
            <ul className="text-slate-300 space-y-1">
              <li>· Import gameplay videos locally</li>
              <li>· Manual cutting, splitting & trimming</li>
              <li>· Slow motion, zooms, filters & cached BGM</li>
              <li>· Write & edit commentary scripts</li>
              <li>· Auto-save projects in IndexedDB</li>
              <li>· On-Device Audio Peak AI & 720p/1080p export</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-[#0A0F18] border border-blue-900/50 space-y-1.5">
            <div className="font-semibold text-blue-400 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" />
              Requires Internet (Cloud AI)
            </div>
            <ul className="text-slate-300 space-y-1">
              <li>· Gemini 4 Vision (Kills, Headshots, Boss Fights)</li>
              <li>· AI Gameplay Commentary Script Generation</li>
              <li>· Hindi & English Neural TTS Voices</li>
              <li>· Downloading Music Pack for offline use</li>
              <li>· Cloud H.264 MP4 & 9:16 Shorts rendering</li>
            </ul>
          </div>
        </div>

        {/* Interactive Cost Calculator */}
        <div className="p-3.5 rounded-xl bg-[#0A0F18] border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">
              Gameplay Length:{' '}
              <strong className="font-mono tabular-nums text-white">{calcMinutes} min</strong>
            </span>
            <input
              type="range"
              min={1}
              max={15}
              value={calcMinutes}
              onChange={(e) => setCalcMinutes(Number(e.target.value))}
              aria-label="Calculator gameplay minutes"
              className="w-full sm:w-44 accent-emerald-500"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">
              Commentary Lines:{' '}
              <strong className="font-mono tabular-nums text-white">
                {calcSentences.toLocaleString()}
              </strong>
            </span>
            <input
              type="range"
              min={10}
              max={5000}
              step={10}
              value={calcSentences}
              onChange={(e) => setCalcSentences(Number(e.target.value))}
              aria-label="Calculator commentary lines"
              className="w-full sm:w-44 accent-blue-500"
            />
          </div>

          <div className="pt-2.5 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-slate-400">Vision AI</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                ${videoAnalysisCost.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Script AI</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                ${scriptCost.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Hindi/EN TTS</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                ${ttsCost.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-emerald-400 font-medium">Est. Cloud Total</div>
              <div className="font-mono tabular-nums font-bold text-emerald-400 mt-0.5">
                ${totalEstimatedCost.toFixed(3)}
              </div>
            </div>
          </div>
        </div>

        {/* Technical Stack Summary */}
        <div className="space-y-2 text-xs">
          <div className="p-2.5 rounded-lg bg-[#0A0F18] border border-slate-800/80 flex items-start gap-2.5">
            <Cpu className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-200">
                Cloud & On-Device AI Engines
              </div>
              <div className="text-slate-400 mt-0.5">
                Cloud: @google/genai gemini-4-hydrogen & gemini-3.8-flash-lite-tts / flash-tts.
                Offline: Web Audio RMS Peak Detector + IndexedDB + optional Android MediaPipe /
                Whisper.cpp / Sherpa-ONNX for native APK builds.
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0A0F18] border border-slate-800/80 flex items-start gap-2.5">
            <Server className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-200">
                Video Processing & Storage Infrastructure
              </div>
              <div className="text-slate-400 mt-0.5">
                Offline: Browser Canvas + WebAudio + MediaRecorder (zero server cost). Cloud:
                FFmpeg H.264/AAC worker (2–4 vCPU, 4 GB RAM, GCS/S3 bucket for 15-min raw uploads).
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#0A0F18] border border-slate-800/80 flex items-start gap-2.5">
            <Smartphone className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-200">
                Android Native & PWA Deployment
              </div>
              <div className="text-slate-400 mt-0.5">
                Installable standalone Android PWA via Service Worker + IndexedDB, or wrap with
                Capacitor + Jetpack Media3 / FFmpegKit for Google Play Store APK/AAB release.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
