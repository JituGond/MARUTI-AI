import React, { useCallback, useEffect, useState } from 'react';
import { Film, Mic, Scissors, Sliders, WifiOff } from 'lucide-react';
import { AnalyzePanel } from './components/AnalyzePanel';
import { EditStylePanel } from './components/EditStylePanel';
import { ExportStackPanel } from './components/ExportStackPanel';
import { ScriptVoicePanel } from './components/ScriptVoicePanel';
import { TimelineStrip } from './components/TimelineStrip';
import { UploadDashboard } from './components/UploadDashboard';
import { VideoPreviewPlayer } from './components/VideoPreviewPlayer';
import { useOnlineStatus } from './hooks/usePWA';
import type {
  BgmTrackOption,
  EditingSettings,
  ExportPresetId,
  ProjectData,
  ScriptLanguage,
  ScriptSentence,
  ScriptStyleId,
  TimelineSegment,
  VoiceSettings,
} from './types';
import { analyzeGameplayOfflineOnDevice } from './utils/offlineAi';
import {
  deleteOfflineProject,
  getVideoBlobOffline,
  hydrateProjectMediaUrls,
  importGameplayVideoOffline,
  listOfflineProjects,
  saveProjectOffline,
  saveVideoBlobOffline,
  saveVoiceClipOffline,
} from './utils/offlineStore';

type StudioTab = 'analyze' | 'edit' | 'script' | 'export';

const DEFAULT_OFFLINE_BGM: BgmTrackOption[] = [
  { id: 'none', name: 'No Background Music', mood: 'Pure gameplay & commentary audio', bpm: 0, url: '' },
  { id: 'boss-rush-edm', name: 'Boss Rush Arena', mood: 'Aggressive gaming synth & kick', bpm: 135, url: '/api/bgm/boss-rush-edm' },
  { id: 'clutch-trap', name: 'Clutch Mode 808', mood: 'Dark high-stakes montage beat', bpm: 140, url: '/api/bgm/clutch-trap' },
  { id: 'victory-anthem', name: 'Victory Royale Anthem', mood: 'Heroic uplifting win theme', bpm: 122, url: '/api/bgm/victory-anthem' },
  { id: 'chill-lobby', name: 'Lobby Loadout Lo-Fi', mood: 'Chill tutorial & tactical breakdown', bpm: 88, url: '/api/bgm/chill-lobby' },
  { id: 'funny-meme', name: 'Arcade Fail Bounce', mood: 'Playful funny gaming moments', bpm: 115, url: '/api/bgm/funny-meme' },
];

export default function App() {
  const isOnline = useOnlineStatus();
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);
  const [bgmCatalog, setBgmCatalog] = useState<BgmTrackOption[]>(DEFAULT_OFFLINE_BGM);
  const [activeTab, setActiveTab] = useState<StudioTab>('analyze');

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [seekRequestSec, setSeekRequestSec] = useState<{ sec: number; nonce: number } | null>(null);

  const loadProjectsAndCatalog = useCallback(async () => {
    const offlineList = await listOfflineProjects().catch(() => []);

    if (navigator.onLine) {
      try {
        const [projRes, bgmRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/bgm'),
        ]);
        if (bgmRes.ok) {
          const data = (await bgmRes.json()) as { tracks: BgmTrackOption[] };
          if (data.tracks?.length) setBgmCatalog(data.tracks);
        }
        if (projRes.ok) {
          const data = (await projRes.json()) as { projects: ProjectData[] };
          const serverMap = new Map(data.projects.map((p) => [p.id, p]));
          const merged = [...data.projects];
          for (const off of offlineList) {
            if (!serverMap.has(off.id)) {
              merged.push(off);
            }
          }
          merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setProjects(merged);
          return;
        }
      } catch {
        // Fallback to offline list below
      }
    }

    setProjects(offlineList);
  }, []);

  useEffect(() => {
    void loadProjectsAndCatalog();
  }, [loadProjectsAndCatalog]);

  // Poll server only for active online cloud export jobs
  useEffect(() => {
    if (!activeProject || activeProject.isLocalOnly || !isOnline) return;
    const hasActiveJobs = activeProject.exports.some(
      (j) => j.status === 'queued' || j.status === 'rendering',
    );
    if (!hasActiveJobs) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${activeProject.id}`);
        if (res.ok) {
          const data = (await res.json()) as { project: ProjectData };
          void saveProjectOffline(data.project);
          setActiveProject(data.project);
          setProjects((prev) =>
            prev.map((p) => (p.id === data.project.id ? data.project : p)),
          );
        }
      } catch {
        // Retry next tick
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeProject, isOnline]);

  // Automatic local project saving on every state change
  const syncProjectState = useCallback((updated: ProjectData) => {
    const stamped: ProjectData = {
      ...updated,
      lastSavedAt: new Date().toISOString(),
    };
    setActiveProject(stamped);
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === stamped.id);
      return exists
        ? prev.map((p) => (p.id === stamped.id ? stamped : p))
        : [stamped, ...prev];
    });
    void saveProjectOffline(stamped);
  }, []);

  const handleOpenProject = async (proj: ProjectData) => {
    const hydrated = await hydrateProjectMediaUrls(proj);
    setActiveProject(hydrated);
    setActiveTab('analyze');
    setCurrentTimeSec(0);
    setAnalyzeError(null);
    setScriptError(null);
  };

  const handleUploadFile = async (
    file: File,
    title: string,
    captureSource: 'mobile-screen' | 'camera-gameplay',
  ) => {
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(5);

    if (!navigator.onLine) {
      try {
        const offlineProj = await importGameplayVideoOffline(file, title);
        syncProjectState(offlineProj);
        setActiveTab('analyze');
        setCurrentTimeSec(0);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : 'Failed to import gameplay offline.',
        );
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
      return;
    }

    const formData = new FormData();
    formData.append('video', file);
    if (title) formData.append('title', title);
    formData.append('captureSource', captureSource);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects/upload');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.min(95, Math.round((ev.loaded / ev.total) * 95)));
      }
    };

    xhr.onload = async () => {
      setIsUploading(false);
      setUploadProgress(100);
      try {
        const data = JSON.parse(xhr.responseText) as {
          project?: ProjectData;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && data.project) {
          // Also cache local video blob in IndexedDB so user can continue editing offline!
          await saveVideoBlobOffline(data.project.id, file).catch(() => {});
          syncProjectState(data.project);
          setActiveTab('analyze');
          setCurrentTimeSec(0);
        } else {
          setUploadError(data.error || 'Gameplay upload failed.');
        }
      } catch {
        setUploadError('Invalid server response during upload.');
      }
    };

    xhr.onerror = async () => {
      // Fallback to offline IndexedDB import if network dropped mid-upload
      try {
        const offlineProj = await importGameplayVideoOffline(file, title);
        syncProjectState(offlineProj);
        setActiveTab('analyze');
        setCurrentTimeSec(0);
      } catch {
        setUploadError('Upload failed. Try again or import offline.');
      } finally {
        setIsUploading(false);
      }
    };

    xhr.send(formData);
  };

  const handleCreateSampleProject = async () => {
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(40);
    try {
      const res = await fetch('/api/projects/sample', { method: 'POST' });
      const data = (await res.json()) as { project?: ProjectData; error?: string };
      if (!res.ok || !data.project) {
        throw new Error(data.error || 'Failed to create sample gameplay project.');
      }
      syncProjectState(data.project);
      setActiveTab('analyze');
      setCurrentTimeSec(0);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Sample creation failed.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteOfflineProject(projectId).catch(() => {});
    if (navigator.onLine) {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => {});
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProject?.id === projectId) {
      setActiveProject(null);
    }
  };

  const handleRunCloudAnalysis = async () => {
    if (!activeProject) return;
    setAnalyzeError(null);
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/analyze`, {
        method: 'POST',
      });
      const data = (await res.json()) as { project?: ProjectData; error?: string };
      if (!res.ok || !data.project) {
        throw new Error(data.error || 'Cloud AI gameplay analysis failed.');
      }
      syncProjectState(data.project);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRunOfflineAnalysis = async () => {
    if (!activeProject) return;
    setAnalyzeError(null);
    setIsAnalyzing(true);
    try {
      const localBlob = await getVideoBlobOffline(activeProject.id);
      const source = localBlob || activeProject.videoUrl;
      const result = await analyzeGameplayOfflineOnDevice(
        source,
        activeProject.metadata.durationSec,
        activeProject.title,
      );
      const updated: ProjectData = {
        ...activeProject,
        analysis: result,
        editing: {
          ...activeProject.editing,
          styleId: result.suggestedStyle,
        },
      };
      syncProjectState(updated);
      if (navigator.onLine && !activeProject.isLocalOnly) {
        void fetch(`/api/projects/${activeProject.id}/segments`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments: result.segments }),
        });
      }
    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : 'On-device offline analysis failed.',
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateSegments = async (segments: TimelineSegment[]) => {
    if (!activeProject) return;
    const optimistic: ProjectData = {
      ...activeProject,
      analysis: activeProject.analysis
        ? { ...activeProject.analysis, segments }
        : {
            gameTitle: activeProject.title,
            captureSource: 'mobile-screen',
            analysisSource: 'ondevice-audio-peaks',
            summary: 'Manual gameplay cuts applied.',
            detectedLanguage: 'Offline',
            suggestedStyle: activeProject.editing.styleId,
            highlights: [],
            segments,
            analyzedAt: new Date().toISOString(),
          },
    };
    syncProjectState(optimistic);

    if (navigator.onLine && !activeProject.isLocalOnly) {
      try {
        await fetch(`/api/projects/${activeProject.id}/segments`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments }),
        });
      } catch {
        // Already saved locally
      }
    }
  };

  const handleToggleSegmentAction = (segmentId: string) => {
    if (!activeProject?.analysis) return;
    const next = activeProject.analysis.segments.map((s) =>
      s.id === segmentId
        ? { ...s, action: (s.action === 'keep' ? 'cut' : 'keep') as 'keep' | 'cut' }
        : s,
    );
    void handleUpdateSegments(next);
  };

  const handleUpdateEditing = async (patch: Partial<EditingSettings>) => {
    if (!activeProject) return;
    const merged = { ...activeProject.editing, ...patch };
    syncProjectState({ ...activeProject, editing: merged });

    if (navigator.onLine && !activeProject.isLocalOnly) {
      try {
        await fetch(`/api/projects/${activeProject.id}/editing`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editing: patch }),
        });
      } catch {
        // Saved locally
      }
    }
  };

  const handleGenerateScript = async (
    style: ScriptStyleId,
    language: ScriptLanguage,
    append = false,
  ) => {
    if (!activeProject) return;
    setScriptError(null);
    setIsGeneratingScript(true);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, language, append }),
      });
      const data = (await res.json()) as { project?: ProjectData; error?: string };
      if (!res.ok || !data.project) {
        throw new Error(data.error || 'Gaming script generation failed.');
      }
      syncProjectState(data.project);
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Script generation failed.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleSaveSentences = async (sentences: ScriptSentence[], scriptTitle?: string) => {
    if (!activeProject) return;
    syncProjectState({
      ...activeProject,
      sentences,
      scriptTitle: scriptTitle ?? activeProject.scriptTitle,
    });
    if (navigator.onLine && !activeProject.isLocalOnly) {
      try {
        await fetch(`/api/projects/${activeProject.id}/script`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sentences, scriptTitle }),
        });
      } catch {
        // Saved offline
      }
    }
  };

  const handleUpdateVoiceSettings = async (patch: Partial<VoiceSettings>) => {
    if (!activeProject) return;
    const merged = { ...activeProject.voiceSettings, ...patch };
    syncProjectState({ ...activeProject, voiceSettings: merged });
    if (navigator.onLine && !activeProject.isLocalOnly) {
      try {
        await fetch(`/api/projects/${activeProject.id}/voice/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voiceSettings: patch }),
        });
      } catch {
        // Saved offline
      }
    }
  };

  const handleGenerateVoiceBatch = async (sentenceIds?: string[], force = false) => {
    if (!activeProject) return;
    const res = await fetch(`/api/projects/${activeProject.id}/voice/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sentenceIds,
        force,
        voiceSettings: activeProject.voiceSettings,
      }),
    });
    const data = (await res.json()) as { project?: ProjectData; error?: string };
    if (data.project) {
      syncProjectState(data.project);
      // Cache generated WAV clips into IndexedDB for offline playback & offline video export
      for (const s of data.project.sentences) {
        if (s.voiceStatus === 'ready' && s.audioUrl && (!sentenceIds || sentenceIds.includes(s.id))) {
          void fetch(s.audioUrl)
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (blob) return saveVoiceClipOffline(data.project!.id, s.id, blob);
            })
            .catch(() => {});
        }
      }
    }
    if (!res.ok) {
      throw new Error(data.error || 'Voice generation failed.');
    }
  };

  const handleStartBatchExport = async (presets: ExportPresetId[]) => {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presets }),
      });
      const data = (await res.json()) as { project?: ProjectData };
      if (res.ok && data.project) {
        syncProjectState(data.project);
      }
    } catch {
      // ignore
    }
  };

  const handleSeek = useCallback((sec: number) => {
    setSeekRequestSec({ sec, nonce: Date.now() });
  }, []);

  const navItems: Array<{ id: StudioTab; label: string; shortLabel: string; icon: React.ReactNode }> = [
    { id: 'analyze', label: 'Analyze & Cut', shortLabel: 'Analyze', icon: <Scissors className="w-5 h-5" /> },
    { id: 'edit', label: 'Edit & FX', shortLabel: 'Edit', icon: <Sliders className="w-5 h-5" /> },
    { id: 'script', label: 'Script & Voice', shortLabel: 'Voice', icon: <Mic className="w-5 h-5" /> },
    { id: 'export', label: 'Export & Offline', shortLabel: 'Export', icon: <Film className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#0A0F18] text-slate-100 flex flex-col">
      {/* Top Bar Contract: Single Row, 3 Zones */}
      <header className="sticky top-0 z-30 h-14 bg-[#0A0F18]/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
        {/* Zone 1: MAHAVIR Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveProject(null)}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="6" fill="#10B981" />
            <path
              d="M5.5 17V7L10 12L12 9.5L14 12L18.5 7V17"
              stroke="#0A0F18"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white">
            MAHAVIR
          </span>
        </button>

        {/* Zone 2: Desktop Navigation Tabs */}
        {activeProject ? (
          <nav className="hidden lg:flex items-center gap-6">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-emerald-400 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="hidden lg:block" />
        )}

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setActiveProject(null)}
            className="min-h-[40px] px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0"
          >
            {activeProject ? 'All Projects' : 'Import Gameplay'}
          </button>
        </div>
      </header>

      {/* Non-intrusive Offline Connectivity Notice */}
      {!isOnline && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-200 flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            Offline Mode Active — Local import, cutting, slow-mo, scripts, cached music & device
            export work without internet.
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className={`flex-1 ${activeProject ? 'pb-24 lg:pb-8' : 'pb-8'}`}>
        {!activeProject ? (
          <UploadDashboard
            projects={projects}
            isOnline={isOnline}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
            onUploadFile={(file, title, src) => void handleUploadFile(file, title, src)}
            onCreateSampleProject={() => void handleCreateSampleProject()}
            onSelectProject={(proj) => void handleOpenProject(proj)}
            onDeleteProject={(id) => void handleDeleteProject(id)}
          />
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Primary Stage: Gameplay Preview + Timeline */}
              <div className="lg:col-span-7 space-y-4 lg:sticky lg:top-20">
                <VideoPreviewPlayer
                  project={activeProject}
                  bgmCatalog={bgmCatalog}
                  currentTimeSec={currentTimeSec}
                  onTimeChange={setCurrentTimeSec}
                  seekRequestSec={seekRequestSec}
                />

                <TimelineStrip
                  project={activeProject}
                  currentTimeSec={currentTimeSec}
                  onSeek={handleSeek}
                  onToggleSegmentAction={handleToggleSegmentAction}
                />
              </div>

              {/* Right Studio Inspector */}
              <div className="lg:col-span-5">
                {activeTab === 'analyze' && (
                  <AnalyzePanel
                    project={activeProject}
                    isOnline={isOnline}
                    currentTimeSec={currentTimeSec}
                    isAnalyzing={isAnalyzing}
                    analyzeError={analyzeError}
                    onRunCloudAnalysis={() => void handleRunCloudAnalysis()}
                    onRunOfflineAnalysis={() => void handleRunOfflineAnalysis()}
                    onUpdateSegments={(segs) => void handleUpdateSegments(segs)}
                    onSeek={handleSeek}
                  />
                )}

                {activeTab === 'edit' && (
                  <EditStylePanel
                    project={activeProject}
                    bgmCatalog={bgmCatalog}
                    isOnline={isOnline}
                    onUpdateEditing={(patch) => void handleUpdateEditing(patch)}
                  />
                )}

                {activeTab === 'script' && (
                  <ScriptVoicePanel
                    project={activeProject}
                    isOnline={isOnline}
                    isGeneratingScript={isGeneratingScript}
                    scriptError={scriptError}
                    onGenerateScript={(style, lang, append) =>
                      void handleGenerateScript(style, lang, append)
                    }
                    onSaveSentences={(sents, title) => void handleSaveSentences(sents, title)}
                    onUpdateVoiceSettings={(patch) => void handleUpdateVoiceSettings(patch)}
                    onGenerateVoiceBatch={handleGenerateVoiceBatch}
                    onSeek={handleSeek}
                  />
                )}

                {activeTab === 'export' && (
                  <ExportStackPanel
                    project={activeProject}
                    isOnline={isOnline}
                    onStartBatchExport={(presets) => void handleStartBatchExport(presets)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Android Bottom Thumb-Zone Navigation */}
      {activeProject && (
        <nav
          aria-label="MAHAVIR studio tabs"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-[#0E1524]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-4 items-center"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span className="text-[10px] font-medium tracking-tight">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
