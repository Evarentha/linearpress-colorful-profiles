/*
 * Colorful Profiles Data Layer
 *
 * SQLite data layer for profile fields and email-verification state.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Data layer for Colorful Profiles.
 *
 * <ul>
 * <li>colorful_profiles: profile extension fields (nickname / avatar / website / description /
 * contact info / representative work).</li>
 * <li>aum_users: reuses the advanced-user-management email-verification state table (this plugin
 * only ensures the table exists and writes verified / token so an email change re-enters mail
 * verification; the token is consumed by AUM's /verify route).</li>
 * </ul>
 *
 * @since 1.0.0
 */

/** databaseService 所需的最小接口（由 ctx.databaseService 满足）。 */
export interface Db {
  run(sql: string, ...params: unknown[]): Promise<{ changes?: number | bigint }>;
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

/** 归一化裁剪参数（相对原图）：x/y 为裁剪框左上角比例，size 为宽占比，sizeY 为高占比（可选，缺省同 size）。 */
export interface Crop { x: number; y: number; size: number; sizeY?: number; }

export interface Profile {
  user_id: number;
  nickname: string | null;
  avatar: string | null;
  /** JSON 字符串化的 Crop */
  avatar_crop: string | null;
  website: string | null;
  bio: string | null;
  contact: string | null;
  representative: string | null;
  updated_at: string | null;
}

export interface ProfileView extends Profile {
  username: string;
  email: string | null;
}

export async function ensureSchema(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS colorful_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT,
      avatar TEXT,
      avatar_crop TEXT,
      website TEXT,
      bio TEXT,
      contact TEXT,
      representative TEXT,
      updated_at TEXT
    );
  `);
  // 邮箱重验证状态复用高级用户管理的表结构（若 AUM 已建则不会改动）。
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aum_users (
      user_id INTEGER PRIMARY KEY,
      verified INTEGER NOT NULL DEFAULT 0,
      verify_token TEXT,
      token_expires_at INTEGER,
      verified_at INTEGER
    );
  `);
}

export async function upsertProfile(db: Db, userId: number, fields: Partial<Profile>): Promise<void> {
  const current = await getProfile(db, userId);
  const merged: Profile = {
    user_id: userId,
    nickname: fields.nickname ?? current?.nickname ?? null,
    avatar: fields.avatar ?? current?.avatar ?? null,
    avatar_crop: fields.avatar_crop ?? current?.avatar_crop ?? null,
    website: fields.website ?? current?.website ?? null,
    bio: fields.bio ?? current?.bio ?? null,
    contact: fields.contact ?? current?.contact ?? null,
    representative: fields.representative ?? current?.representative ?? null,
    updated_at: new Date().toISOString()
  };
  await db.run(
    `INSERT INTO colorful_profiles(user_id,nickname,avatar,avatar_crop,website,bio,contact,representative,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       nickname=excluded.nickname, avatar=excluded.avatar, avatar_crop=excluded.avatar_crop,
       website=excluded.website, bio=excluded.bio, contact=excluded.contact,
       representative=excluded.representative, updated_at=excluded.updated_at`,
    merged.user_id, merged.nickname, merged.avatar, merged.avatar_crop, merged.website,
    merged.bio, merged.contact, merged.representative, merged.updated_at
  );
}

export async function getProfile(db: Db, userId: number): Promise<Profile | undefined> {
  return db.get<Profile>('SELECT * FROM colorful_profiles WHERE user_id=?', userId);
}

export async function getProfileView(db: Db, userId: number): Promise<ProfileView | undefined> {
  return db.get<ProfileView>(
    `SELECT p.*, u.username, u.email FROM colorful_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?`,
    userId
  );
}

/** 通过用户名查用户 + profile 视图（供公开资料页）。 */
export async function profileViewByUsername(db: Db, username: string): Promise<(Profile & { username: string; email: string | null }) | undefined> {
  const row = await db.get<{
    user_id: number; username: string; email: string | null;
    nickname: string | null; avatar: string | null; avatar_crop: string | null;
    website: string | null; bio: string | null; contact: string | null; representative: string | null; updated_at: string | null;
  }>(
    `SELECT u.id AS user_id, u.username, u.email, p.nickname, p.avatar, p.avatar_crop,
            p.website, p.bio, p.contact, p.representative, p.updated_at
     FROM users u LEFT JOIN colorful_profiles p ON p.user_id=u.id WHERE u.username=?`,
    username
  );
  return row;
}

/** 全表 profile + 用户名映射，供 site:locals 注入（文章/评论作者头像与昵称）。 */
export async function loadProfilesMap(db: Db): Promise<Map<number, { username: string; email: string | null; nickname: string | null; avatar: string | null; avatar_crop: string | null }>> {
  const rows = await db.all<{ user_id: number; username: string; email: string | null; nickname: string | null; avatar: string | null; avatar_crop: string | null }>(
    `SELECT u.id AS user_id, u.username, u.email, p.nickname, p.avatar, p.avatar_crop
     FROM users u LEFT JOIN colorful_profiles p ON p.user_id=u.id`
  );
  const map = new Map<number, { username: string; email: string | null; nickname: string | null; avatar: string | null; avatar_crop: string | null }>();
  for (const row of rows) map.set(row.user_id, row);
  return map;
}

// ------------------------------------------------------------ 邮箱重验证（复用 aum_users）

export interface VerifyRow { user_id: number; verified: number; verify_token: string | null; token_expires_at: number | null; verified_at: number | null; }

export async function getVerifyRow(db: Db, userId: number): Promise<VerifyRow | undefined> {
  return db.get<VerifyRow>('SELECT user_id, verified, verify_token, token_expires_at, verified_at FROM aum_users WHERE user_id=?', userId);
}

export async function isEmailVerified(db: Db, userId: number): Promise<boolean> {
  const row = await getVerifyRow(db, userId);
  return Boolean(row?.verified);
}

/** 标记某邮箱待验证（改邮箱后调用）：user 回到「注册刚完成未验证」状态。 */
export async function markEmailPending(db: Db, userId: number, token: string, expiresAt: number): Promise<void> {
  await db.run(
    `INSERT INTO aum_users(user_id, verified, verify_token, token_expires_at, verified_at)
     VALUES(?,0,?,?,NULL)
     ON CONFLICT(user_id) DO UPDATE SET verified=0, verify_token=excluded.verify_token,
       token_expires_at=excluded.token_expires_at, verified_at=NULL`,
    userId, token, expiresAt
  );
}

/** 直接更新 users.email（Base 的 users 服务未暴露更新邮箱）。 */
export async function updateUserEmail(db: Db, userId: number, email: string | null): Promise<void> {
  await db.run('UPDATE users SET email=? WHERE id=?', email, userId);
}
