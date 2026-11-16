import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import type {
  EditingSettings,
  ExportJob,
  ExportPresetId,
  ProjectData,
  ScriptLanguage,
  ScriptSentence,
  ScriptStyleId,
  TimelineSegment,
  VoiceSettings,
} from './src/types.ts';
import {
  analyzeVideoWithGemini,
  generateScriptWithGemini,
  generateVoiceOverWav,
} from './server/gemini.ts';
import {
  BGM_CATALOG,
  MAX_VIDEO_DURATION_SEC,
  concatenateWavFiles,
  ensureBackgroundMusicAssets,
  extractThumbnails,
  generateSampleGameplayVideo,
  getWavDurationSec,
  normalizeVideoIfNeeded,
  probeVideo,
  renderProjectExport,
} from './server/media.ts';
import {
  BGM_DIR,
  WORKSPACE_ROOT,
  deleteProject,
  ensureProjectDirs,
  ensureWorkspaceDirs,
  getProject,
  getProjectPaths,
  listProjects,
  saveProject,
} from './server/store.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_SENTENCES_PER_PROJECT = 5000;

ensureWorkspaceDirs();
ensureBackgroundMusicAssets();

const uploadTempDir = path.join(WORKSPACE_ROOT, 'uploads');
fs.mkdirSync(uploadTempDir, { recursive: true });

const upload = multer({
  dest: uploadTempDir,
  limits: {
    fileSize: 1536 * 1024 * 1024,
  },
});

const exportQueue: Array<{ projectId: string; jobId: string }> = [];
let isRenderingQueue = false;

async function processExportQueue(): Promise<void> {
  if (isRenderingQueue) return;
  isRenderingQueue = true;

  try {
    while (exportQueue.length > 0) {
      const next = exportQueue.shift();
      if (!next) continue;

      const project = getProject(next.projectId);
      if (!project) continue;

      const job = project.exports.find((e) => e.id === next.jobId);
      if (!job) continue;

      job.status = 'rendering';
      job.progress = 2;
      saveProject(project);

      try {
        const paths = getProjectPaths(project.id);
        const result = await renderProjectExport(project, job, paths, (pct) => {
          const latest = getProject(project.id);
          const targetJob = latest?.exports.find((e) => e.id === job.id);
          if (targetJob && targetJob.status === 'rendering') {
            targetJob.progress = pct;
            saveProject(latest!);
          }
        });

        const latest = getProject(project.id);
        const targetJob = latest?.exports.find((e) => e.id === job.id);
        if (latest && targetJob) {
          targetJob.status = 'completed';
          targetJob.progress = 100;
          targetJob.outputSizeBytes = result.sizeBytes;
          targetJob.downloadUrl = `/api/projects/${project.id}/exports/${job.id}/download`;
          targetJob.completedAt = new Date().toISOString();
          saveProject(latest);
        }
      } catch (err) {
        const latest = getProject(project.id);
        const targetJob = latest?.exports.find((e) => e.id === job.id);
        if (latest && targetJob) {
          targetJob.status = 'failed';
          targetJob.error = err instanceof Error ? err.message : 'Export rendering failed.';
          saveProject(latest);
        }
      }
    }
  } finally {
    isRenderingQueue = false;
  }
}

function streamRangeFile(
  req: express.Request,
  res: express.Response,
  filePath: string,
  contentType: string,
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const clampedEnd = Math.min(end, fileSize - 1);
    const chunksize = clampedEnd - start + 1;
    const stream = fs.createReadStream(filePath, { start, end: clampedEnd });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function buildDefaultProject(
  id: string,
  title: string,
  metadata: ProjectData['metadata'],
  thumbnails: string[],
): ProjectData {
  const now = new Date().toISOString();
  return {
    id,
    title,
    videoUrl: `/api/projects/${id}/video`,
    thumbnails,
    metadata,
    analysis: null,
    editing: {
      styleId: 'clutch-montage',
      transitionType: 'flash',
      zoomIntensity: 'dynamic',
      visualEffect: 'killcam-contrast',
      slowMoOnHighlights: true,
      enhanceColor: true,
      bgmTrackId: 'boss-rush-edm',
      bgmVolume: 0.16,
      originalAudioMode: 'duck',
      autoCaptions: true,
    },
    scriptStyle: 'youtube-commentary',
    scriptLanguage: 'en',
    scriptTitle: '',
    scriptSummary: '',
    sentences: [],
    voiceSettings: {
      language: 'en',
      voiceId: 'Fenrir',
      voiceStyle: 'hype-caster',
      speakingSpeed: 1.0,
      expressiveMode: false,
    },
    exports: [],
    createdAt: now,
    lastSavedAt: now,
  };
}

const PRESET_LABELS: Record<ExportPresetId, string> = {
  'youtube-1080p': 'YouTube Gaming Master (1080p MP4)',
  'youtube-720p': 'Mobile Fast Render (720p MP4)',
  'youtube-shorts': 'Gaming Shorts / Reels (9:16 MP4)',
  'audio-master-wav': 'Master Commentary Voice Stem (WAV)',
};

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'MAHAVIR',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.get('/api/bgm', (_req, res) => {
    res.json({ tracks: BGM_CATALOG });
  });

  app.get('/api/bgm/:id', (req, res) => {
    const safeId = path.basename(req.params.id).replace(/\.wav$/, '');
    const filePath = path.join(BGM_DIR, `${safeId}.wav`);
    streamRangeFile(req, res, filePath, 'audio/wav');
  });

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const ok = deleteProject(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/projects/upload', upload.single('video'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No gameplay video file uploaded.' });
      return;
    }

    const projectId = crypto.randomUUID();
    const paths = ensureProjectDirs(projectId);

    try {
      const metadata = await probeVideo(file.path, file.originalname);
      if (metadata.durationSec > MAX_VIDEO_DURATION_SEC) {
        fs.unlinkSync(file.path);
        deleteProject(projectId);
        res.status(400).json({
          error: `Gameplay video is ${Math.round(metadata.durationSec)}s long. Maximum supported duration is 15 minutes (900s).`,
        });
        return;
      }

      const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
      const tempExtPath = path.join(paths.root, `raw${ext}`);
      fs.renameSync(file.path, tempExtPath);
      await normalizeVideoIfNeeded(tempExtPath, paths.sourceVideo);

      const finalMeta = await probeVideo(paths.sourceVideo, file.originalname);
      const thumbs = await extractThumbnails(
        paths.sourceVideo,
        paths.thumbsDir,
        finalMeta.durationSec,
        projectId,
        10,
      );

      const title =
        (typeof req.body?.title === 'string' && req.body.title.trim()) ||
        path.basename(file.originalname, path.extname(file.originalname)) ||
        'Untitled Gameplay Session';

      const project = buildDefaultProject(projectId, title, finalMeta, thumbs);
      saveProject(project);
      res.json({ project });
    } catch (err) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      deleteProject(projectId);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to process uploaded gameplay video.',
      });
    }
  });

  app.post('/api/projects/sample', async (_req, res) => {
    const projectId = crypto.randomUUID();
    const paths = ensureProjectDirs(projectId);
    try {
      await generateSampleGameplayVideo(paths.sourceVideo);
      const metadata = await probeVideo(paths.sourceVideo, 'mobile_clutch_gameplay.mp4');
      const thumbs = await extractThumbnails(
        paths.sourceVideo,
        paths.thumbsDir,
        metadata.durationSec,
        projectId,
        10,
      );
      const project = buildDefaultProject(
        projectId,
        'Mobile Ranked Match (Sample Gameplay)',
        metadata,
        thumbs,
      );
      saveProject(project);
      res.json({ project });
    } catch (err) {
      deleteProject(projectId);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate sample gameplay video.',
      });
    }
  });

  app.get('/api/projects/:id/video', (req, res) => {
    const paths = getProjectPaths(req.params.id);
    streamRangeFile(req, res, paths.sourceVideo, 'video/mp4');
  });

  app.get('/api/projects/:id/thumbs/:file', (req, res) => {
    const paths = getProjectPaths(req.params.id);
    const filePath = path.join(paths.thumbsDir, path.basename(req.params.file));
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(filePath);
  });

  app.get('/api/projects/:id/voice/:file', (req, res) => {
    const paths = getProjectPaths(req.params.id);
    const filePath = path.join(paths.voiceDir, path.basename(req.params.file));
    streamRangeFile(req, res, filePath, 'audio/wav');
  });

  app.post('/api/projects/:id/analyze', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    try {
      const paths = getProjectPaths(project.id);
      const analysis = await analyzeVideoWithGemini(
        project.id,
        paths.sourceVideo,
        project.metadata.durationSec,
      );
      project.analysis = analysis;
      project.editing.styleId = analysis.suggestedStyle;
      project.lastSavedAt = new Date().toISOString();
      saveProject(project);
      res.json({ project });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI gameplay analysis failed.',
      });
    }
  });

  app.patch('/api/projects/:id/segments', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const segments = req.body?.segments as TimelineSegment[] | undefined;
    if (!Array.isArray(segments)) {
      res.status(400).json({ error: 'Invalid segments array.' });
      return;
    }
    if (!project.analysis) {
      project.analysis = {
        gameTitle: project.title,
        captureSource: 'mobile-screen',
        analysisSource: 'ondevice-audio-peaks',
        summary: 'Manual gameplay timeline cuts.',
        detectedLanguage: 'English',
        suggestedStyle: project.editing.styleId,
        highlights: [],
        segments,
        analyzedAt: new Date().toISOString(),
      };
    } else {
      project.analysis.segments = segments;
    }
    project.lastSavedAt = new Date().toISOString();
    saveProject(project);
    res.json({ project });
  });

  app.patch('/api/projects/:id/editing', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const editing = req.body?.editing as Partial<EditingSettings> | undefined;
    if (!editing) {
      res.status(400).json({ error: 'Missing editing payload.' });
      return;
    }
    project.editing = {
      ...project.editing,
      ...editing,
    };
    project.lastSavedAt = new Date().toISOString();
    saveProject(project);
    res.json({ project });
  });

  app.post('/api/projects/:id/script', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const style = (req.body?.style as ScriptStyleId) || project.scriptStyle;
    const language = (req.body?.language as ScriptLanguage) || project.scriptLanguage;
    const append = Boolean(req.body?.append);

    if (append && project.sentences.length >= MAX_SENTENCES_PER_PROJECT) {
      res.status(400).json({
        error: `Project has reached the maximum limit of ${MAX_SENTENCES_PER_PROJECT} sentences.`,
      });
      return;
    }

    try {
      const paths = getProjectPaths(project.id);
      const lastEnd =
        append && project.sentences.length > 0
          ? project.sentences[project.sentences.length - 1].endSec
          : undefined;

      const generated = await generateScriptWithGemini(
        project,
        paths.sourceVideo,
        style,
        language,
        append
          ? {
              appendAfterSec: lastEnd,
              existingCount: project.sentences.length,
            }
          : undefined,
      );

      project.scriptStyle = style;
      project.scriptLanguage = language;
      project.voiceSettings.language = language;

      if (append) {
        project.sentences = [...project.sentences, ...generated.sentences].slice(
          0,
          MAX_SENTENCES_PER_PROJECT,
        );
      } else {
        project.scriptTitle = generated.scriptTitle;
        project.scriptSummary = generated.scriptSummary;
        project.sentences = generated.sentences.slice(0, MAX_SENTENCES_PER_PROJECT);
        project.masterVoiceUrl = undefined;
      }

      project.lastSavedAt = new Date().toISOString();
      saveProject(project);
      res.json({ project });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI gaming script generation failed.',
      });
    }
  });

  app.patch('/api/projects/:id/script', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const sentences = req.body?.sentences as ScriptSentence[] | undefined;
    if (!Array.isArray(sentences)) {
      res.status(400).json({ error: 'Invalid sentences array.' });
      return;
    }
    if (sentences.length > MAX_SENTENCES_PER_PROJECT) {
      res.status(400).json({
        error: `Maximum ${MAX_SENTENCES_PER_PROJECT} sentences allowed per project.`,
      });
      return;
    }
    project.sentences = sentences;
    if (typeof req.body?.scriptTitle === 'string') {
      project.scriptTitle = req.body.scriptTitle;
    }
    project.lastSavedAt = new Date().toISOString();
    saveProject(project);
    res.json({ project });
  });

  app.patch('/api/projects/:id/voice/settings', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const settings = req.body?.voiceSettings as Partial<VoiceSettings> | undefined;
    if (!settings) {
      res.status(400).json({ error: 'Missing voiceSettings payload.' });
      return;
    }
    project.voiceSettings = {
      ...project.voiceSettings,
      ...settings,
    };
    project.lastSavedAt = new Date().toISOString();
    saveProject(project);
    res.json({ project });
  });

  app.post('/api/projects/:id/voice/generate', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const sentenceIds = req.body?.sentenceIds as string[] | undefined;
    const force = Boolean(req.body?.force);
    const voiceSettings = (req.body?.voiceSettings as VoiceSettings) || project.voiceSettings;
    project.voiceSettings = voiceSettings;

    const targets = project.sentences.filter((s) => {
      if (sentenceIds && sentenceIds.length > 0) {
        return sentenceIds.includes(s.id);
      }
      return force || s.voiceStatus !== 'ready';
    });

    if (targets.length === 0) {
      res.json({ project });
      return;
    }

    const paths = getProjectPaths(project.id);
    const errors: string[] = [];

    for (const sentence of targets) {
      try {
        const wavBuffer = await generateVoiceOverWav(
          sentence.text,
          voiceSettings,
          sentence.speakerTone,
        );
        const wavPath = path.join(paths.voiceDir, `${sentence.id}.wav`);
        fs.writeFileSync(wavPath, wavBuffer);
        sentence.audioDurationSec = getWavDurationSec(wavPath);
        sentence.audioUrl = `/api/projects/${project.id}/voice/${sentence.id}.wav?t=${Date.now()}`;
        sentence.voiceStatus = 'ready';
        sentence.voiceError = undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'TTS failed';
        sentence.voiceStatus = 'error';
        sentence.voiceError = msg;
        errors.push(msg);
      }
    }

    const readyPaths = project.sentences
      .filter((s) => s.voiceStatus === 'ready')
      .map((s) => path.join(paths.voiceDir, `${s.id}.wav`))
      .filter((p) => fs.existsSync(p));

    if (readyPaths.length > 0) {
      const masterPath = path.join(paths.voiceDir, 'master_voiceover.wav');
      concatenateWavFiles(readyPaths, masterPath);
      project.masterVoiceUrl = `/api/projects/${project.id}/voice/master_voiceover.wav?t=${Date.now()}`;
    }

    project.lastSavedAt = new Date().toISOString();
    saveProject(project);

    if (errors.length > 0 && errors.length === targets.length) {
      res.status(500).json({ error: errors[0], project });
      return;
    }
    res.json({ project, warning: errors.length > 0 ? errors[0] : undefined });
  });

  app.post('/api/projects/:id/exports', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const presets = req.body?.presets as ExportPresetId[] | undefined;
    if (!Array.isArray(presets) || presets.length === 0) {
      res.status(400).json({ error: 'Select at least one export preset.' });
      return;
    }

    const createdJobs: ExportJob[] = presets.map((presetId) => ({
      id: crypto.randomUUID(),
      projectId: project.id,
      presetId,
      label: PRESET_LABELS[presetId] || presetId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    }));

    project.exports = [...createdJobs, ...project.exports];
    project.lastSavedAt = new Date().toISOString();
    saveProject(project);

    for (const job of createdJobs) {
      exportQueue.push({ projectId: project.id, jobId: job.id });
    }
    void processExportQueue();

    res.json({ project, jobs: createdJobs });
  });

  app.get('/api/projects/:id/exports/:jobId/download', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const job = project.exports.find((e) => e.id === req.params.jobId);
    if (!job || job.status !== 'completed') {
      res.status(404).json({ error: 'Export file is not ready.' });
      return;
    }
    const paths = getProjectPaths(project.id);
    const ext = job.presetId === 'audio-master-wav' ? 'wav' : 'mp4';
    const filePath = path.join(paths.exportsDir, `${job.id}.${ext}`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Export file missing on disk.' });
      return;
    }
    const safeTitle = project.title.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
    res.download(filePath, `mahavir_${safeTitle}_${job.presetId}.${ext}`);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MAHAVIR AI Gaming Video Studio listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
