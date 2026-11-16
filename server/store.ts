import fs from 'fs';
import path from 'path';
import type { ProjectData } from '../src/types.ts';

export const WORKSPACE_ROOT = '/tmp/cutflow';
export const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');
export const BGM_DIR = path.join(WORKSPACE_ROOT, 'bgm');

export function ensureWorkspaceDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(BGM_DIR, { recursive: true });
}

export interface ProjectPaths {
  root: string;
  sourceVideo: string;
  thumbsDir: string;
  voiceDir: string;
  exportsDir: string;
  jsonPath: string;
}

export function getProjectPaths(projectId: string): ProjectPaths {
  const root = path.join(PROJECTS_DIR, projectId);
  return {
    root,
    sourceVideo: path.join(root, 'source.mp4'),
    thumbsDir: path.join(root, 'thumbs'),
    voiceDir: path.join(root, 'voice'),
    exportsDir: path.join(root, 'exports'),
    jsonPath: path.join(root, 'project.json'),
  };
}

export function ensureProjectDirs(projectId: string): ProjectPaths {
  const p = getProjectPaths(projectId);
  fs.mkdirSync(p.root, { recursive: true });
  fs.mkdirSync(p.thumbsDir, { recursive: true });
  fs.mkdirSync(p.voiceDir, { recursive: true });
  fs.mkdirSync(p.exportsDir, { recursive: true });
  return p;
}

const projectCache = new Map<string, ProjectData>();
const geminiFileUriCache = new Map<string, { uri: string; mimeType: string; name: string }>();

export function saveProject(project: ProjectData): void {
  const paths = ensureProjectDirs(project.id);
  projectCache.set(project.id, project);
  fs.writeFileSync(paths.jsonPath, JSON.stringify(project, null, 2), 'utf-8');
}

export function getProject(projectId: string): ProjectData | null {
  const cached = projectCache.get(projectId);
  if (cached) return cached;
  const paths = getProjectPaths(projectId);
  if (fs.existsSync(paths.jsonPath)) {
    try {
      const raw = fs.readFileSync(paths.jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as ProjectData;
      projectCache.set(projectId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function listProjects(): ProjectData[] {
  ensureWorkspaceDirs();
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const results: ProjectData[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const p = getProject(d.name);
    if (p) results.push(p);
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteProject(projectId: string): boolean {
  projectCache.delete(projectId);
  geminiFileUriCache.delete(projectId);
  const paths = getProjectPaths(projectId);
  if (fs.existsSync(paths.root)) {
    fs.rmSync(paths.root, { recursive: true, force: true });
    return true;
  }
  return false;
}

export function setGeminiFileCache(
  projectId: string,
  info: { uri: string; mimeType: string; name: string },
): void {
  geminiFileUriCache.set(projectId, info);
}

export function getGeminiFileCache(
  projectId: string,
): { uri: string; mimeType: string; name: string } | undefined {
  return geminiFileUriCache.get(projectId);
}
