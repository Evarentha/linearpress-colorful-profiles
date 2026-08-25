/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 头像子系统：magic bytes 检测、动画识别、尺寸/大小校验、multipart 文件解析、
 * 磁盘读写（无损保留原图，动画帧不被破坏；正方形裁剪坐标交由 CSS 呈现）。
 */

import type { Request } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import type { CpConfig } from './config.js';

export interface ImageInfo { kind: 'gif' | 'png' | 'jpeg' | 'webp'; animated: boolean; }
export interface UploadPart { field?: string; filename: string; mimeType: string; buffer: Buffer; }

/** 通过 magic bytes 识别图片格式与是否动画。 */
export function detectImage(buffer: Buffer): ImageInfo | null {
  if (buffer.length >= 6) {
    const head6 = buffer.toString('latin1', 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') {
      // 图像分隔符(0x2C)多于 1 个或含 NETSCAPE 循环扩展 => 动态 GIF
      const isText = buffer.toString('latin1');
      const separators = (isText.match(/\x2c/g) || []).length;
      return { kind: 'gif', animated: separators > 1 || buffer.includes(Buffer.from('NETSCAPE')) };
    }
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') {
    // acTL 块 => APNG（动态 PNG）
    const animated = buffer.includes(Buffer.from('acTL'), 8);
    return { kind: 'png', animated };
  }
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { kind: 'jpeg', animated: false };
  }
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return { kind: 'webp', animated: false };
  }
  return null;
}

export const EXT_BY_KIND: Record<ImageInfo['kind'], string> = { gif: 'gif', png: 'png', jpeg: 'jpg', webp: 'webp' };

/** 校验头像：格式/动画开关/文件大小/画面尺寸，返回扩展名（不含点）。 */
export function validateAvatar(buffer: Buffer, config: CpConfig, clientWidth?: unknown, clientHeight?: unknown): ImageInfo {
  const info = detectImage(buffer);
  if (!info) throw new Error('不支持的图片格式，仅支持 JPG / PNG / GIF / WebP。');

  const sizeMb = buffer.length / 1024 / 1024;
  if (sizeMb > config.avatarMaxFileSizeMb) {
    throw new Error(`头像文件不能超过 ${config.avatarMaxFileSizeMb}MB（当前 ${sizeMb.toFixed(2)}MB）。`);
  }

  if (info.animated) {
    if (info.kind === 'gif' && !config.allowGif) throw new Error('站点设置不允许使用 GIF 动态头像，请更换静态图片。');
    if (info.kind === 'png' && !config.allowApng) throw new Error('站点设置不允许使用动态 PNG(APNG) 头像，请更换静态图片。');
  }

  const w = Number(clientWidth) || 0;
  const h = Number(clientHeight) || 0;
  if (w > config.avatarSizeLimitPx || h > config.avatarSizeLimitPx) {
    throw new Error(`头像画面尺寸不能超过 ${config.avatarSizeLimitPx}×${config.avatarSizeLimitPx}。`);
  }
  return info;
}

// ------------------------------------------------------------ multipart 解析

const MAX_BODY = 20 * 1024 * 1024; // 头像文件上限 + 冗余

export async function readRawBody(req: Request): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY) throw new Error('头像文件过大。');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; files: UploadPart[] } {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('上传请求缺少 multipart boundary');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields: Record<string, string> = {};
  const files: UploadPart[] = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const start = cursor + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const raw = body.slice(start, next);
    cursor = next;
    if (raw.length < 4) continue;
    let part = raw;
    if (part[0] === 13) part = part.slice(2); // 去掉起始 CRLF
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString('latin1');
    let data = part.slice(headerEnd + 4);
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) data = data.slice(0, -2);
    const nameMatch = header.match(/name="([^"]*)"/);
    const name = nameMatch ? nameMatch[1] : undefined;
    const fileMatch = header.match(/filename="([^"]*)"/);
    const ctMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
    if (fileMatch && name) {
      files.push({ field: name, filename: fileMatch[1], mimeType: ctMatch ? ctMatch[1].trim() : '', buffer: data });
    } else if (name) {
      fields[name] = data.toString('utf8');
    }
  }
  return { fields, files };
}

// ------------------------------------------------------------ 头像文件磁盘读写

export interface AvatarStore {
  rootDir: string;      // 站点 uploads 根
  subDir: string;       // 头像子目录，如 avatars
}

export function avatarDir(store: AvatarStore): string {
  return path.join(store.rootDir, store.subDir);
}

/** 读取并规范化裁剪参数；非法输入返回 null。 */
export function parseCrop(raw: unknown): { x: number; y: number; size: number; sizeY?: number } | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (typeof value !== 'object' || !value) return null;
  const obj = value as Record<string, unknown>;
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const x = num(obj.x); const y = num(obj.y); const size = num(obj.size);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size <= 0) return null;
  const out: { x: number; y: number; size: number; sizeY?: number } = {
    x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), size: Math.max(0.01, Math.min(1, size))
  };
  const sizeY = num(obj.sizeY);
  if (Number.isFinite(sizeY) && sizeY > 0) out.sizeY = Math.max(0.01, Math.min(1, sizeY));
  return out;
}

/** 写入头像并替换旧文件；返回公开 URL。 */
export async function storeAvatar(store: AvatarStore, userId: number, buffer: Buffer, ext: string): Promise<string> {
  await fs.ensureDir(avatarDir(store));
  // 删除该用户既有头像（不同扩展名）以实现替换。
  const existing = await listUserAvatars(store, userId);
  for (const file of existing) await fs.remove(path.join(avatarDir(store), file));
  const filename = `${userId}.${ext}`;
  await fs.writeFile(path.join(avatarDir(store), filename), buffer);
  return `/uploads/avatars/${filename}`;
}

async function listUserAvatars(store: AvatarStore, userId: number): Promise<string[]> {
  try {
    const files = await fs.readdir(avatarDir(store));
    return files.filter((file) => file.startsWith(`${userId}.`));
  } catch {
    return [];
  }
}

/** 解析 /uploads/avatars/:file 并确保路径安全；返回本地绝对路径或 null。 */
export function resolveAvatarFile(store: AvatarStore, file: string): string | null {
  const name = String(file ?? '').replace(/.*[\\/]/g, ''); // 仅取 basename
  if (!name || name.includes('..')) return null;
  const full = path.resolve(avatarDir(store), name);
  const base = path.resolve(avatarDir(store)) + path.sep;
  if (!full.startsWith(base)) return null;
  return full;
}
