/*
 * Colorful Profiles Plugin Entry
 *
 * Cordis-native plugin entry wiring routes, views and profile features for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Colorful Profiles plugin entry (Cordis-native plugin; the default export is the activate phase).
 *
 * Features:
 *  1. User menu on the right: avatar + nickname / @username / email, edit-profile entry and other
 *     plugin items (including AUM personal settings).
 *  2. Profile edit page /profile/edit: avatar (file upload + square cropping, GIF/APNG supported),
 *     nickname, email, website, description (Markdown), contact info and representative work;
 *     double confirmation on save + intrusive prompt when changing email.
 *  3. Email re-verification: integrates advanced-user-management; after an email change the
 *     account returns to unverified state and cannot post articles or comments until verified.
 *  4. Public profile page /user/:username: nickname, username, email, avatar, website,
 *     description, representative work and a recent-posts timeline (grouped by month, +N lazyload).
 *  5. Avatar display: beside article authors and comment authors, next to the top-right name and
 *     in its expanded menu; optional avatar picking from the media library.
 *
 * Dependencies: advanced-comments (comment views / comment form) and advanced-user-management
 * (email verification). Loads after both (the later-loaded plugin's views take priority).
 *
 * @since 1.0.0
 */

import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'cordis';
import type { Request, RequestHandler, Response } from 'express';
import { postUrl } from '../../core/permalinks.js';
import { defaultViewFallback } from './src/default-view.js';
import { loadConfig, saveConfig, type CpConfig, type PluginConfigService } from './src/config.js';
import type { EmailVerifyLike } from './src/email.js';
import { buildVerificationMail, sendVerificationMail } from './src/email.js';
import type { Db, Profile } from './src/store.js';
import {
  ensureSchema, getProfile, getProfileView, getVerifyRow, loadProfilesMap,
  markEmailPending, updateUserEmail, upsertProfile
} from './src/store.js';
import { avatarDir, detectImage, parseCrop, parseMultipart, readRawBody, resolveAvatarFile, storeAvatar, validateAvatar, AvatarStore } from './src/avatar.js';
import { renderMarkdown } from './src/markdown.js';

const PLUGIN_ID = 'colorful-profiles';
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANAGE_PERMISSION = 'colorful-profiles:manage';
const SETTINGS_URL = '/admin/colorful-profiles/settings';
const AVATAR_STATIC_PREFIX = '/uploads/avatars';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const text = (value: unknown): string => String(value ?? '').trim();

function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
function json(res: Response, status: number, payload: unknown): void { res.status(status).json(payload); }
/** JSON API 处理器包装：失败时返回 { ok:false }（与 Base JSON 约定一致）。 */
const wrapJson = (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler => (req, res) => {
  void Promise.resolve(fn(req, res)).catch((error) => json(res, 500, { ok: false, message: messageOf(error) }));
};

async function isEnabled(ctx: Context, id: string): Promise<boolean> {
  try {
    const list = await ctx.plugins.list();
    const item = (list ?? []).find((p: { id: string; enabled: number }) => p.id === id);
    return Boolean(item && item.enabled);
  } catch { return false; }
}

/** 读取高级用户管理的邮件验证配置（未安装/未启用返回 null）。 */
async function aumEmailVerify(ctx: Context): Promise<EmailVerifyLike | null> {
  const cfg = await (ctx.plugins as unknown as PluginConfigService).getConfig<Record<string, unknown>>('advanced-user-management') ?? {};
  const ev = (cfg.emailVerify && typeof cfg.emailVerify === 'object' ? cfg.emailVerify : {}) as Record<string, unknown>;
  if (!ev.enable) return null;
  const smtp = (ev.smtp && typeof ev.smtp === 'object' ? ev.smtp : {}) as Record<string, unknown>;
  return {
    enable: true,
    tokenTtlHours: Number(ev.tokenTtlHours) || 48,
    smtp: {
      host: String(smtp.host ?? ''),
      port: Number(smtp.port) || 25,
      encryption: smtp.encryption === 'ssl' || smtp.encryption === 'starttls' || smtp.encryption === 'none' ? smtp.encryption as 'ssl' | 'starttls' | 'none' : 'starttls',
      user: String(smtp.user ?? ''),
      password: String(smtp.password ?? ''),
      from: String(smtp.from ?? '')
    },
    template: ev.template === 'custom' ? 'custom' : 'default',
    templateContent: String(ev.templateContent ?? '')
  };
}

export default async function colorfulProfiles(ctx: Context): Promise<void> {
  const { web, hooks, admin } = ctx.linearpress;
  const db = ctx.databaseService as unknown as Db;

  let config: CpConfig = await loadConfig(ctx.plugins);
  await ensureSchema(db);
  await ctx.permissions.register(MANAGE_PERMISSION, '管理多彩个人资料');

  const [aumEnabled, acEnabled, mediaEnabled] = await Promise.all([
    isEnabled(ctx, 'advanced-user-management'),
    isEnabled(ctx, 'advanced-comments'),
    isEnabled(ctx, 'media-library')
  ]);
  if (!aumEnabled || !acEnabled) {
    console.warn(`[${PLUGIN_ID}] 依赖插件未全部启用（需要 advanced-comments + advanced-user-management），部分功能降级。`);
  }

  // Theme views stay authoritative; only Base's default views use our fallback.
  web.viewDir(path.join(PLUGIN_DIR, 'views'));
  web.middleware(defaultViewFallback());

  const avatarStore: AvatarStore = {
    rootDir: path.join(process.cwd(), 'uploads'),
    subDir: config.avatarDir
  };

  // ------------------------------------------------------------ 权限守卫（与 Base requireAuth/checkPermission 同构）
  const requireLogin: RequestHandler = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
  };
  /** 管理端守卫工厂：登录 + colorful-profiles:manage 权限校验，失败渲染 error 视图。 */
  const checkManagePermission = (): RequestHandler => async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const allowed = await Promise.resolve(ctx.permissions.has(req.session.userId, MANAGE_PERMISSION)).catch(() => false);
    if (!allowed) return res.status(403).render('error', { title: '权限不足', message: '你没有管理多彩个人资料的权限。' });
    next();
  };
  const requireManage = checkManagePermission();

  // ------------------------------------------------------------ site:locals 注入
  // profiles 全量映射缓存：site:locals 每请求触发，users JOIN profiles 全表查询以 TTL + 写入失效控制成本。
  const PROFILES_TTL_MS = 15_000;
  let profilesCache: { at: number; data: Awaited<ReturnType<typeof loadProfilesMap>> } | null = null;
  const invalidateProfilesCache = (): void => { profilesCache = null; };
  const profilesMap = async () => {
    if (profilesCache && Date.now() - profilesCache.at < PROFILES_TTL_MS) return profilesCache.data;
    const data = await loadProfilesMap(db);
    profilesCache = { at: Date.now(), data };
    return data;
  };

  hooks.on('site:locals', async (locals: Record<string, unknown>) => {
    config = await loadConfig(ctx.plugins);
    avatarStore.subDir = config.avatarDir;
    const profiles = await profilesMap();
    const parseCropJson = (raw: string | null): { x: number; y: number; size: number; sizeY?: number } | null => {
      if (!raw) return null;
      try {
        const v = JSON.parse(raw);
        if (!v || typeof v.size !== 'number' || v.size <= 0) return null;
        const out: { x: number; y: number; size: number; sizeY?: number } = { x: Number(v.x) || 0, y: Number(v.y) || 0, size: Number(v.size) };
        if (typeof v.sizeY === 'number' && v.sizeY > 0) out.sizeY = Number(v.sizeY);
        return out;
      } catch { return null; }
    };
    const cfDisplayName = (id: number): string => {
      const p = profiles.get(Number(id));
      return p && p.nickname && p.nickname.trim() ? p.nickname : (p?.username || '用户');
    };
    const cfAvatarHtml = (id: number, px = 40, cls = ''): string => {
      const p = profiles.get(Number(id));
      const name = (p?.nickname || p?.username || '?').trim();
      const initial = name.charAt(0).toUpperCase() || '?';
      if (!p?.avatar) {
        return `<span class="cf-avatar ${cls}" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.42)}px">${esc(initial)}</span>`;
      }
      const url = esc(p.avatar);
      const crop = parseCropJson(p.avatar_crop);
      let style = `width:${px}px;height:${px}px;background-image:url('${url}');`;
      if (crop) {
        const sx = crop.size;
        const sy = crop.sizeY || crop.size;
        // 裁剪框近乎铺满整图时 (1 - sx) 趋于 0，位置计算会除零：退回居中呈现。
        style += `background-size:${((1 / sx) * 100).toFixed(2)}%;`;
        style += sx >= 0.999 || sy >= 0.999 ? 'background-position:center;' : `background-position:${((crop.x / (1 - sx)) * 100).toFixed(2)}% ${((crop.y / (1 - sy)) * 100).toFixed(2)}%;`;
      } else {
        style += 'background-size:cover;background-position:center;';
      }
      return `<span class="cf-avatar cf-avatar-img ${cls}" style="${style}" role="img" aria-label="${esc(name)}"></span>`;
    };
    const cfProfileHref = (id: number): string | null => {
      const p = profiles.get(Number(id));
      return p?.username ? `/user/${encodeURIComponent(p.username)}` : null;
    };
    const colorfulUsers: Record<number, { username: string; email: string | null; nickname: string | null; avatar: string | null; avatar_crop: string | null }> = {};
    for (const [id, value] of profiles) colorfulUsers[id] = value;

    // 用户菜单扩展条目：编辑个人资料之后追加的“其他插件项”（如 AUM 个人设置）。
    const extra: Array<{ title: string; link: string; icon?: string }> = [];
    if (aumEnabled) extra.push({ title: '个人设置', link: '/profile/settings' });
    const collected = (await hooks.collect('profile:userMenu', [])) as Array<{ title: string; link: string; icon?: string }>;
    for (const item of collected) if (item && item.title && item.link) extra.push(item);

    return {
      ...locals,
      colorfulUsers,
      acCommentError: locals.acCommentError ?? '',
      colorfulProfilesPostView: path.join(PLUGIN_DIR, 'views/cp-post.ejs'),
      cfDisplayName,
      cfAvatarHtml,
      cfProfileHref,
      cpUserMenuItems: extra,
      colorfulProfilesReady: true,
      cfEmailVerifyEnabled: aumEnabled ? Boolean(await aumEmailVerify(ctx)) : false
    };
  });

  // ------------------------------------------------------------ 资料编辑页
  web.register('get', '/profile/edit', requireLogin, async (req, res) => {
    const user = await ctx.users.findById(req.session.userId!);
    if (!user) return res.status(404).render('error', { title: '用户不存在', message: '当前登录用户不存在。' });
    const profile = (await getProfile(db, user.id)) as (Profile & { email?: string }) | undefined;
    const verify = await getVerifyRow(db, user.id);
    const ev = aumEnabled ? await aumEmailVerify(ctx) : null;
    res.render('profile-edit', {
      title: '编辑个人资料',
      user: { ...user, email: profile?.email ?? user.email },
      profile: profile ?? { user_id: user.id, nickname: '', avatar: null, avatar_crop: null, website: '', bio: '', contact: '', representative: '', updated_at: null },
      config,
      cp: {
        avatarUrl: profile?.avatar ?? null,
        avatarCrop: profile?.avatar_crop ? JSON.parse(profile.avatar_crop) : null,
        aumEnabled,
        mediaEnabled,
        emailVerifyEnabled: Boolean(ev),
        verified: Boolean(verify?.verified),
        avatarSizeLimitPx: config.avatarSizeLimitPx,
        avatarMaxFileSizeMb: config.avatarMaxFileSizeMb
      }
    });
  });

  // JSON API：使用 wrapJson，失败统一返回 { ok:false }。
  web.register('post', '/profile/edit', requireLogin, wrapJson(async (req, res) => {
    const userId = req.session.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = await ctx.users.findById(userId);
    if (!user) return json(res, 404, { ok: false, message: '用户不存在' });

    const nickname = text(body.nickname).slice(0, 60);
    const websiteRaw = text(body.website).slice(0, 300);
    const website =
      /^https?:\/\/[^\s]+$/i.test(websiteRaw) ? websiteRaw :
      /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(websiteRaw) ? `https://${websiteRaw}` :
      '';
    const bio = String(body.bio ?? '').slice(0, 5000);
    const contact = text(body.contact).slice(0, 300);
    const representative = text(body.representative).slice(0, 300);
    const newEmailRaw = text(body.email);

    // 邮箱变更
    let needsVerify = false;
    let emailChanged = false;
    if (newEmailRaw !== (user.email ?? '')) {
      emailChanged = true;
      const sanitized = newEmailRaw || null;
      const ev = aumEnabled ? await aumEmailVerify(ctx) : null;
      if (ev) {
        // 先发验证邮件，发送成功后再提交变更，避免用户被置于无法验证的状态。
        const token = randomUUID().replace(/-/g, '');
        // 优先使用站点配置主域名，防止 Host 头投毒污染激活链接。
        const site = await ctx.config.get();
        const primary = text(site.primaryDomain ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        const origin = primary ? `${req.protocol}://${primary}` : `${req.protocol}://${req.get('host')}`;
        const mail = buildVerificationMail(ev, {
          siteName: site.siteName || 'LinearPress',
          username: user.username,
          verifyUrl: `${origin}/verify?token=${token}`,
          siteUrl: origin
        });
        await sendVerificationMail(ev, sanitized ?? '', mail.subject, mail.html).catch((error: unknown) => { throw new Error(`验证邮件发送失败，邮箱未变更：${messageOf(error)}`); });
        await updateUserEmail(db, userId, sanitized);
        await markEmailPending(db, userId, token, Date.now() + ev.tokenTtlHours * 3600 * 1000);
        invalidateProfilesCache();
        needsVerify = true;
      } else {
        await updateUserEmail(db, userId, sanitized);
        invalidateProfilesCache();
      }
    }

    // 媒体库头像选择（表单携带 avatar 字段）
    let avatar = text(body.avatar);
    let avatarCrop: string | null = null;
    if (avatar && !avatar.startsWith(AVATAR_STATIC_PREFIX)) {
      // 确认是合法的媒体库或站内图片路径；含路径回溯一律视为非法
      if (!/^\/(media-library\/files|uploads|plugins)\//.test(avatar) || avatar.includes('..')) avatar = '';
    }
    if (avatar && !avatar.startsWith(AVATAR_STATIC_PREFIX)) {
      // 直接引用站内 URL 的头像（旧客户端/手工提交）：按同一动画策略校验源文件
      const relative = avatar.replace(/^\/(media-library\/files|uploads)\//, '');
      const pluginMatch = avatar.match(/^\/plugins\/([^/]+)\/(.+)$/);
      const localPath = relative !== avatar
        ? path.join(avatarStore.rootDir, relative)
        : pluginMatch
          ? path.join(process.cwd(), 'src', 'plugins', pluginMatch[1], 'public', pluginMatch[2])
          : null;
      if (localPath) {
        try {
          const info = detectImage(await fs.readFile(localPath));
          if (info?.animated && ((info.kind === 'gif' && !config.allowGif) || (info.kind === 'png' && !config.allowApng))) {
            return json(res, 400, { ok: false, message: '站点设置不允许使用动态头像，请更换静态图片。' });
          }
        } catch { /* 源文件不可读时交由后续空值回退 */ }
      }
    }
    // 移除头像
    if (text(body.avatar_removed) === '1') { avatar = ''; avatarCrop = ''; }

    const fields: Partial<Profile> = { nickname: nickname || null, website: website || null, bio: bio || null, contact: contact || null, representative: representative || null };
    if (avatar) { fields.avatar = avatar; fields.avatar_crop = null; }
    else if (avatarCrop === '') { fields.avatar = null; fields.avatar_crop = null; }
    await upsertProfile(db, userId, fields);
    invalidateProfilesCache();

    json(res, 200, {
      ok: true,
      emailChanged,
      needsVerify,
      message: needsVerify ? '资料已保存。邮箱已变更，请前往新邮箱完成验证后恢复完整权限。' : '资料已保存。'
    });
  }));

  // ------------------------------------------------------------ 头像上传
  web.register('post', '/profile/avatar', requireLogin, wrapJson(async (req, res) => {
    const userId = req.session.userId!;
    const contentType = String(req.headers['content-type'] ?? '');
    const body = await readRawBody(req);
    const { fields, files } = parseMultipart(body, contentType);
    const file = files.find((f) => f.field === 'avatar') ?? files[0];
    if (!file || !file.buffer.length) return json(res, 400, { ok: false, message: '未选择头像文件。' });

    const info = validateAvatar(file.buffer, config, fields.width, fields.height);
    const crop = parseCrop(fields.crop) ?? null;
    const ext = { gif: 'gif', png: 'png', jpeg: 'jpg', webp: 'webp' }[info.kind];
    const url = await storeAvatar(avatarStore, userId, file.buffer, ext);
    await upsertProfile(db, userId, { avatar: url, avatar_crop: crop ? JSON.stringify(crop) : null });
    invalidateProfilesCache();
    json(res, 200, { ok: true, avatarUrl: url, crop });
  }));

  // 头像静态托管
  web.register('get', `${AVATAR_STATIC_PREFIX}/:file`, async (req, res) => {
    const filePath = resolveAvatarFile(avatarStore, String(req.params.file ?? ''));
    if (!filePath) return res.status(404).end();
    res.sendFile(filePath, (error) => {
      if (!error || res.headersSent) return;
      const status = (error as Error & { statusCode?: number }).statusCode;
      res.status(status || 404).end();
    });
  });

  // ------------------------------------------------------------ 公开资料页
  web.register('get', '/user/:username', requireLogin, async (req, res) => {
    const username = text(req.params.username);
    const user = await ctx.users.findByUsername(username);
    if (!user) return res.status(404).render('error', { title: '用户不存在', message: '未找到该用户。' });
    const profileView = await getProfileView(db, user.id);
    const merged = { ...(profileView ?? { user_id: user.id, username, email: user.email, nickname: null, avatar: null, avatar_crop: null, website: null, bio: null, contact: null, representative: null, updated_at: null }) };
    const pageSize = config.timelinePageSize;
    const posts = await listUserPosts(db, user.id, 0, pageSize, await ctx.config.get());
    res.render('profile-view', {
      title: `${merged.nickname || merged.username} 的个人资料`,
      user,
      profile: merged,
      bioHtml: merged.bio ? renderMarkdown(merged.bio) : '',
      posts: posts.items,
      timelinePageSize: pageSize,
      hasMore: posts.hasMore
    });
  });

  // 时间线 lazyload API
  web.register('get', '/api/profiles/:username/posts', requireLogin, wrapJson(async (req, res) => {
    const user = await ctx.users.findByUsername(text(req.params.username));
    if (!user) return json(res, 404, { ok: false, message: '用户不存在' });
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || config.timelinePageSize));
    const result = await listUserPosts(db, user.id, offset, limit, await ctx.config.get());
    json(res, 200, { ok: true, posts: result.items, hasMore: result.hasMore, nextOffset: offset + limit });
  }));

  // ------------------------------------------------------------ 管理端 设置页
  hooks.on('admin:menu', (menu: Array<{ title: string; link: string }>) => [...menu, { title: '多彩个人资料', link: SETTINGS_URL }]);
  admin.registerCustomSetting({ label: '多彩个人资料设置', link: SETTINGS_URL });

  web.register('get', SETTINGS_URL, requireLogin, requireManage, (_req, res) => {
    res.render('admin/cp-settings', {
      title: '多彩个人资料 · 设置',
      config,
      notice: _req.query.notice ?? ''
    });
  });
  web.register('post', SETTINGS_URL, requireLogin, requireManage, async (req, res) => {
    try {
      const { parseSettingsForm } = await import('./src/config.js');
      config = parseSettingsForm((req.body ?? {}) as Record<string, unknown>);
      await saveConfig(ctx.plugins, config);
      res.redirect(`${SETTINGS_URL}?notice=saved`);
    } catch (error) {
      res.status(400).render('admin/cp-settings', { title: '多彩个人资料 · 设置', config, notice: `保存失败：${messageOf(error)}` });
    }
  });

  web.register('get', '/api/colorful-profiles/deps', requireLogin, requireManage, (_req, res) => {
    res.json({ ok: true, ac: acEnabled, aum: aumEnabled, media: mediaEnabled });
  });

  // ------------------------------------------------------------ 未验证越权防护：发文章
  hooks.on('post:beforeSave', async (payload: Record<string, unknown>) => {
    if (!aumEnabled) return payload;
    const ev = await aumEmailVerify(ctx);
    if (!ev) return payload;
    // 仅拦截新建文章（无 id）；已发布/编辑不受影响。
    if (payload.id || !payload.author_id) return payload;
    const userId = Number(payload.author_id);
    const verify = await getVerifyRow(db, userId);
    if (verify && !verify.verified) {
      throw new Error('你的邮箱尚未完成验证，暂时无法发布文章。请前往资料页重新验证邮箱。');
    }
    return payload;
  });

  ctx.logger.info(`colorful-profiles activated (aum=${aumEnabled}, ac=${acEnabled}, media=${mediaEnabled})`);
}

// ------------------------------------------------------------ 共享工具

function listUserPostsQuery(db: Db, authorId: number, offset: number, limit: number): Promise<Array<{
  id: number; title: string; slug: string; created_at: string;
}>> {
  return db.all(
    `SELECT id, title, slug, created_at FROM posts WHERE author_id=? AND status='published' ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    authorId, limit, offset
  ) as Promise<Array<{ id: number; title: string; slug: string; created_at: string }>>;
}

async function listUserPosts(db: Db, authorId: number, offset: number, limit: number, site: { permalink: string }): Promise<{ items: Array<{ id: number; title: string; slug: string; url: string; created_at: string }>; hasMore: boolean }> {
  const rows = await listUserPostsQuery(db, authorId, offset, limit);
  const next = await listUserPostsQuery(db, authorId, offset + limit, 1);
  return {
    items: rows.map((row) => ({ ...row, url: postUrl(row, site.permalink) })),
    hasMore: next.length > 0
  };
}
