/*
 * Colorful Profiles Avatars
 *
 * Image type, animation and size checks done on the file itself, and avatar storage.
 *
 * Authors:
 * MoyuZJ <moyuzj@evarentha.com> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@evarentha.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <p>The original file is kept untouched so animated GIF/APNG frames survive;
 * the square crop is applied with CSS when the avatar is shown. Dimensions are
 * read from the file headers (3.x trusted sizes sent by the browser).</p>
 *
 * @since 1.0.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import type { CpConfig } from './config.js';

export interface ImageInfo { kind: 'gif' | 'png' | 'jpeg' | 'webp'; animated: boolean; width: number; height: number; }
export const EXT_BY_KIND: Record<ImageInfo['kind'], string> = { gif: 'gif', png: 'png', jpeg: 'jpg', webp: 'webp' };

function jpegSize(b: Buffer): [number, number] {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + length;
  }
  return [0, 0];
}
function webpSize(b: Buffer): [number, number] {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return [0, 0];
}

/** Format, animation and pixel size from the bytes; null for anything else. */
export function detectImage(b: Buffer): ImageInfo | null {
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) {
    return { kind: 'gif', animated: b.includes(Buffer.from('NETSCAPE2.0')) || (b.toString('latin1').match(/\x21\xf9\x04/g) || []).length > 1, width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'png', animated: b.includes(Buffer.from('acTL')), width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { const [width, height] = jpegSize(b); return { kind: 'jpeg', animated: false, width, height }; }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') { const [width, height] = webpSize(b); return { kind: 'webp', animated: b.includes(Buffer.from('ANIM')), width, height }; }
  return null;
}

export function validateAvatar(buffer: Buffer, config: CpConfig): ImageInfo {
  const info = detectImage(buffer);
  if (!info) throw new Error('只支持 JPG、PNG、GIF、WebP 图片');
  if (buffer.length > config.avatarMaxFileSizeMb * 1024 * 1024) throw new Error(`头像不能超过 ${config.avatarMaxFileSizeMb}MB`);
  if (info.animated && ((info.kind === 'gif' && !config.allowGif) || (info.kind !== 'gif' && !config.allowApng))) throw new Error('站点不允许动态头像，请换一张静态图片');
  if (info.width > config.avatarSizeLimitPx || info.height > config.avatarSizeLimitPx) throw new Error(`图片太大：${info.width}×${info.height}，最大 ${config.avatarSizeLimitPx}×${config.avatarSizeLimitPx}`);
  if (!info.width || !info.height) throw new Error('无法读取图片尺寸，图片可能已损坏');
  return info;
}

export const AVATAR_ROOT = path.join(process.cwd(), 'uploads', 'avatars');

/** Replace the user's avatar file; the URL carries a version so browsers fetch the new one. */
export async function storeAvatar(userId: number, buffer: Buffer, ext: string): Promise<string> {
  await fs.ensureDir(AVATAR_ROOT);
  for (const file of await fs.readdir(AVATAR_ROOT)) if (file.startsWith(`${userId}.`)) await fs.remove(path.join(AVATAR_ROOT, file));
  await fs.writeFile(path.join(AVATAR_ROOT, `${userId}.${ext}`), buffer);
  return `/uploads/avatars/${userId}.${ext}?v=${Date.now().toString(36)}`;
}
export async function removeAvatar(userId: number): Promise<void> {
  if (!await fs.pathExists(AVATAR_ROOT)) return;
  for (const file of await fs.readdir(AVATAR_ROOT)) if (file.startsWith(`${userId}.`)) await fs.remove(path.join(AVATAR_ROOT, file));
}
