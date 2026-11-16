import type { BgmTrackOption, ProjectData, VideoMetadata } from '../types';

const DB_NAME = 'mahavir_offline_v1';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_VIDEOS = 'videoBlobs';
const STORE_BGM = 'bgmBlobs';
const STORE_VOICE = 'voiceBlobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS);
      }
      if (!db.objectStoreNames.contains(STORE_BGM)) {
        db.createObjectStore(STORE_BGM);
      }
      if (!db.objectStoreNames.contains(STORE_VOICE)) {
        db.createObjectStore(STORE_VOICE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve((req.result || []).map(String));
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectOffline(project: ProjectData): Promise<void> {
  // Strip transient blob: URLs before persisting metadata; we re-hydrate blob URLs on load
  const cleanProject: ProjectData = {
    ...project,
    videoUrl: project.videoUrl.startsWith('blob:') ? '' : project.videoUrl,
    lastSavedAt: new Date().toISOString(),
  };
  await idbPut(STORE_PROJECTS, cleanProject);
}

export async function listOfflineProjects(): Promise<ProjectData[]> {
  const projects = await idbGetAll<ProjectData>(STORE_PROJECTS);
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteOfflineProject(projectId: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, projectId);
  await idbDelete(STORE_VIDEOS, projectId);
}

export async function saveVideoBlobOffline(projectId: string, blob: Blob): Promise<void> {
  await idbPut(STORE_VIDEOS, blob, projectId);
}

export async function getVideoBlobOffline(projectId: string): Promise<Blob | undefined> {
  return idbGet<Blob>(STORE_VIDEOS, projectId);
}

export async function hydrateProjectMediaUrls(project: ProjectData): Promise<ProjectData> {
  const cloned: ProjectData = { ...project };
  const localBlob = await getVideoBlobOffline(project.id);
  if (localBlob && (!cloned.videoUrl || cloned.isLocalOnly || !navigator.onLine)) {
    cloned.videoUrl = URL.createObjectURL(localBlob);
  }
  return cloned;
}

export async function getCachedBgmTrackIds(): Promise<string[]> {
  return idbGetAllKeys(STORE_BGM);
}

export async function getOfflineBgmUrl(trackId: string): Promise<string | null> {
  const blob = await idbGet<Blob>(STORE_BGM, trackId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function downloadOfflineMusicPack(
  tracks: BgmTrackOption[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const downloadable = tracks.filter((t) => t.id !== 'none' && t.url);
  const downloaded: string[] = [];

  for (let i = 0; i < downloadable.length; i++) {
    const track = downloadable[i];
    const existing = await idbGet<Blob>(STORE_BGM, track.id);
    if (existing) {
      downloaded.push(track.id);
    } else {
      const res = await fetch(track.url);
      if (res.ok) {
        const blob = await res.blob();
        await idbPut(STORE_BGM, blob, track.id);
        downloaded.push(track.id);
      }
    }
    onProgress?.(i + 1, downloadable.length);
  }

  return downloaded;
}

export async function saveVoiceClipOffline(
  projectId: string,
  sentenceId: string,
  blob: Blob,
): Promise<void> {
  await idbPut(STORE_VOICE, blob, `${projectId}_${sentenceId}`);
}

export async function getVoiceClipOffline(
  projectId: string,
  sentenceId: string,
): Promise<Blob | undefined> {
  return idbGet<Blob>(STORE_VOICE, `${projectId}_${sentenceId}`);
}

export async function extractBrowserVideoMetadataAndThumbs(
  file: File,
): Promise<{ metadata: VideoMetadata; thumbnails: string[]; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not read gameplay video file in browser.'));
  });

  const durationSec = Math.round((video.duration || 0) * 100) / 100;
  if (durationSec > 900) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(
      `Gameplay video is ${Math.round(durationSec)}s long. Maximum supported duration is 15 minutes (900s).`,
    );
  }

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  // Extract 8 thumbnails locally via canvas
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = Math.max(135, Math.round((240 * height) / width));
  const ctx = canvas.getContext('2d');
  const thumbnails: string[] = [];
  const count = 8;
  const step = Math.max(durationSec / count, 0.4);

  for (let i = 0; i < count; i++) {
    const ts = Math.min(Math.max(i * step + 0.1, 0), Math.max(durationSec - 0.1, 0));
    try {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnails.push(canvas.toDataURL('image/jpeg', 0.65));
          }
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = ts;
      });
    } catch {
      // ignore single frame error
    }
  }

  return {
    objectUrl,
    thumbnails,
    metadata: {
      durationSec,
      width,
      height,
      fps: 30,
      hasAudio: true,
      codec: file.type || 'video/mp4',
      sizeBytes: file.size,
      fileName: file.name,
    },
  };
}

export async function importGameplayVideoOffline(
  file: File,
  title: string,
): Promise<ProjectData> {
  const { metadata, thumbnails, objectUrl } = await extractBrowserVideoMetadataAndThumbs(file);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await saveVideoBlobOffline(id, file);

  const project: ProjectData = {
    id,
    title: title || file.name.replace(/\.[^/.]+$/, '') || 'Offline Gameplay Session',
    videoUrl: objectUrl,
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
    isLocalOnly: true,
    createdAt: now,
    lastSavedAt: now,
  };

  await saveProjectOffline(project);
  return project;
}
