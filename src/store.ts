/*
 * Colorful Profiles Store
 *
 * Profile fields kept next to the core user record.
 *
 * Authors:
 * MoyuZJ <moyuzj@evarentha.com> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@evarentha.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DatabaseService } from 'linearpress/plugin-api';

export interface Crop { x: number; y: number; size: number; sizeY?: number; }
export interface Profile { user_id: number; nickname: string | null; avatar: string | null; avatar_crop: string | null; website: string | null; bio: string | null; contact: string | null; representative: string | null; show_email: number; updated_at: string | null; }
export const EMPTY = (userId: number): Profile => ({ user_id: userId, nickname: null, avatar: null, avatar_crop: null, website: null, bio: null, contact: null, representative: null, show_email: 0, updated_at: null });

export async function ensureSchema(db: DatabaseService): Promise<void> {
  const mysql = db.dialect === 'mysql';
  const str = (n: number) => mysql ? `VARCHAR(${n})` : 'TEXT';
  await db.exec(`CREATE TABLE IF NOT EXISTS colorful_profiles (user_id ${mysql ? 'INT' : 'INTEGER'} PRIMARY KEY, nickname ${str(60)} NULL, avatar ${str(500)} NULL, avatar_crop ${str(200)} NULL, website ${str(300)} NULL, bio TEXT NULL, contact ${str(300)} NULL, representative ${str(300)} NULL, show_email INT NOT NULL DEFAULT 0, updated_at ${str(40)} NULL)`);
  if (!await db.hasColumn('colorful_profiles', 'show_email')) await db.exec('ALTER TABLE colorful_profiles ADD COLUMN show_email INT NOT NULL DEFAULT 0');
}

export const getProfile = async (db: DatabaseService, userId: number) => (await db.get<Profile>('SELECT * FROM colorful_profiles WHERE user_id = ?', userId)) ?? EMPTY(userId);
export const allProfiles = (db: DatabaseService) => db.all<Profile>('SELECT * FROM colorful_profiles');
export async function saveProfile(db: DatabaseService, profile: Profile): Promise<void> {
  const { user_id, ...rest } = profile;
  await db.upsert('colorful_profiles', { user_id, ...rest }, ['user_id'], Object.keys(rest));
}

export function parseCrop(raw: unknown): Crop | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const n = (v: unknown) => Number(v);
    if (!value || !(n(value.size) > 0 && n(value.size) <= 1)) return null;
    const crop: Crop = { x: Math.min(1, Math.max(0, n(value.x) || 0)), y: Math.min(1, Math.max(0, n(value.y) || 0)), size: n(value.size) };
    if (n(value.sizeY) > 0 && n(value.sizeY) <= 1) crop.sizeY = n(value.sizeY);
    return crop;
  } catch { return null; }
}
