import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Loader2,
  Play,
  Smartphone,
  Trash2,
  UploadCloud,
  WifiOff,
} from 'lucide-react';
import type { ProjectData } from '../types';
import { formatBytes, formatDurationShort } from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

interface UploadDashboardProps {
  projects: ProjectData[];
  isOnline: boolean;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  onUploadFile: (
    file: File,
    title: string,
    captureSource: 'mobile-screen' | 'camera-gameplay',
  ) => void;
  onCreateSampleProject: () => void;
  onSelectProject: (project: ProjectData) => void;
  onDeleteProject: (projectId: string) => void;
}

export const UploadDashboard: React.FC<UploadDashboardProps> = ({
  projects,
  isOnline,
  isUploading,
  uploadProgress,
  uploadError,
  onUploadFile,
  onCreateSampleProject,
  onSelectProject,
  onDeleteProject,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [captureSource, setCaptureSource] = useState<'mobile-screen' | 'camera-gameplay'>(
    'mobile-screen',
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onUploadFile(files[0], projectTitle.trim(), captureSource);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Dominant Anchor: Gameplay Import Studio */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-[#111827] border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2.5">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
                AI Gaming Video Studio for Gameplay Creators.
              </h1>
              <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">
                Built exclusively for mobile screen recordings and camera gameplay up to 15
                minutes. Detect kills, headshots, boss fights, and victories—plus offline cutting,
                music, scripts, and 720p/1080p export.
              </p>
            </div>
            <PWAInstallButton />
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="mahavir-project-title"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Match / Video Title (Optional)
                </label>
                <input
                  id="mahavir-project-title"
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="e.g. BGMI 18-Kill Final Circle Clutch"
                  className="w-full min-h-[44px] bg-[#0A0F18] border border-slate-800 focus:border-blue-500 rounded-xl px-3.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  Gameplay Capture Source
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0A0F18] border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setCaptureSource('mobile-screen')}
                    className={`min-h-[36px] rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      captureSource === 'mobile-screen'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Screen Rec
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaptureSource('camera-gameplay')}
                    className={`min-h-[36px] rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      captureSource === 'camera-gameplay'
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Camera Rec
                  </button>
                </div>
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => !isUploading && fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-6 sm:p-10 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-emerald-400 bg-emerald-500/10'
                  : 'border-slate-700 hover:border-blue-500/70 bg-[#0A0F18]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />

              {isUploading ? (
                <div className="space-y-3 max-w-sm mx-auto">
                  <Loader2 className="w-9 h-9 text-emerald-400 animate-spin mx-auto" />
                  <div className="text-sm font-semibold text-white">
                    {isOnline
                      ? `Importing & caching gameplay locally... ${uploadProgress}%`
                      : 'Importing gameplay offline into device storage...'}
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-200"
                      style={{ width: `${Math.max(8, uploadProgress)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
                    <UploadCloud className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm sm:text-base font-semibold text-slate-100">
                      {isOnline
                        ? 'Tap to import gameplay or drop video file here'
                        : 'Import gameplay video offline (saved locally)'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      MP4, MOV, WebM, MKV · Up to 15 minutes · Works online & offline
                    </p>
                  </div>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              {!isOnline && <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />}
              <span>
                {isOnline
                  ? 'Want to test kill detection, slow-mo & Hindi commentary immediately?'
                  : 'Offline Mode active: import any video from Android storage to edit offline.'}
              </span>
            </div>
            <button
              type="button"
              onClick={onCreateSampleProject}
              disabled={isUploading || !isOnline}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Create Sample Gameplay Clip
            </button>
          </div>
        </div>

        {/* Right Column: Auto-Saved Projects + Gaming Pipeline */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="flex-1 bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-blue-400" />
                Saved Gaming Projects
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            </div>

            {projects.length === 0 ? (
              <div className="py-10 px-4 text-center rounded-xl bg-[#0A0F18] border border-slate-800/80 space-y-2">
                <Gamepad2 className="w-7 h-7 text-slate-600 mx-auto" />
                <p className="text-sm font-medium text-slate-300">No gameplay projects yet</p>
                <p className="text-xs text-slate-500">
                  Import a screen recording or generate a sample match to begin.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {projects.map((p) => {
                  const keptCount =
                    p.analysis?.segments.filter((s) => s.action === 'keep').length ?? 0;
                  const cutCount =
                    p.analysis?.segments.filter((s) => s.action === 'cut').length ?? 0;
                  return (
                    <div
                      key={p.id}
                      onClick={() => onSelectProject(p)}
                      className="p-2.5 rounded-xl bg-[#0A0F18] border border-slate-800 hover:border-blue-500/60 cursor-pointer transition-colors flex items-center gap-3"
                    >
                      <div className="w-20 h-12 rounded-lg bg-slate-900 overflow-hidden shrink-0 border border-slate-800">
                        {p.thumbnails[0] ? (
                          <img
                            src={p.thumbnails[0]}
                            alt={p.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Gamepad2 className="w-4 h-4 text-slate-600" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {p.title}
                        </div>
                        <div className="text-xs text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span>{formatDurationShort(p.metadata.durationSec)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(p.metadata.sizeBytes)}</span>
                          {p.isLocalOnly && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-blue-400 font-sans">Local Offline</span>
                            </>
                          )}
                          {p.analysis && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400 font-sans">
                                {keptCount} keep / {cutCount} cut
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProject(p.id);
                        }}
                        aria-label={`Delete ${p.title}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800/80 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              MAHAVIR Hybrid AI + Offline Studio
            </h3>
            <div className="space-y-2.5 text-xs text-slate-400">
              <div>
                <span className="font-semibold text-slate-200">
                  01. Kill, Headshot & Boss Detection
                </span>
                <span className="block mt-0.5">
                  Cloud Vision AI watches full gameplay (Internet) or On-Device Peak AI scans
                  combat audio spikes (100% Offline).
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/70">
                <span className="font-semibold text-slate-200">
                  02. Slow-Mo, Gaming Music & Hindi/EN Voice
                </span>
                <span className="block mt-0.5">
                  Manual cuts, slow motion, cached music & scripts work offline; AI script & TTS
                  sync via internet.
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/70">
                <span className="font-semibold text-slate-200">
                  03. Offline 720p/1080p & Cloud MP4 Export
                </span>
                <span className="block mt-0.5">
                  Render directly to Android storage offline or queue cloud FFmpeg MP4 renders.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
