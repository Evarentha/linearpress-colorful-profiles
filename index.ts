/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 多彩个人资料插件入口（Cordis 原生插件，export default 即 activate 阶段）。
 *
 * 功能：
 *  1. 右侧用户菜单：头像+昵称/@用户名/邮箱，编辑个人资料 + 其他插件项（含 AUM 个人设置）。
 *  2. 资料编辑页 /profile/edit：头像(文件上传+正方形裁剪，支持 GIF/APNG)、昵称、邮箱、网站、
 *     描述(Markdown)、联系方式、代表作；保存二次确认 + 改邮箱侵入式提示。
 *  3. 邮箱重验证：接入 advanced-user-management，改邮箱后回到未验证状态，验证前无法发文/评论。
 *  4. 公开资料页 /user/:username：昵称、用户名、邮箱、头像、网站、描述、代表作、最近文章时间线
 *     （按月分组，lazyload +N）。
 *  5. 头像展示：文章作者左侧、评论作者左侧、右上角名称左侧与展开菜单；媒体库选择头像（可选）。
 *
 * 依赖：advanced-comments（评论视图/评论表单）、advanced-user-management（邮箱验证）。
 * 加载顺序晚于二者（后加载者视图优先）。
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'cordis';
import type { Request, RequestHandler, Response } from 'express';
import { postUrl } from '../../core/permalinks.js';
import { getBaseConfig } from '../../services/config.service.js';
import { loadConfig, saveConfig, type CpConfig, type PluginConfigService } from './src/config.js';
import type { EmailVerifyLike } from './src/email.js';
import { buildVerificationMail, sendVerificationMail } from './src/email.js';
import type { Db, Profile } from './src/store.js';
import {
  ensureSchema, getProfile, getProfileView, getVerifyRow, loadProfilesMap,
  markEmailPending, updateUserEmail, upsertProfile
} from './src/store.js';
import { avatarDir, parseCrop, parseMultipart, readRawBody, resolveAvatarFile, storeAvatar, validateAvatar, AvatarStore } from './src/avatar.js';
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
function aumEmailVerify(ctx: Context): EmailVerifyLike | null {
  const cfg = (ctx.plugins as unknown as PluginConfigService).getConfig<Record<string, unknown>>('advanced-user-management') ?? {};
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

  let config: CpConfig = loadConfig(ctx.plugins);
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

  // activate 阶段注册视图目录：与 advanced-comments 相同的机制，确保覆盖的
  // layouts/web.ejs / web/post.ejs 在倒序解析时拥有最高优先级。
  web.viewDir(path.join(PLUGIN_DIR, 'views'));

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
  hooks.on('site:locals', async (locals: Record<string, unknown>) => {
    const profiles = await loadProfilesMap(db);
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
        style += `background-size:${((1 / sx) * 100).toFixed(2)}%;background-position:${((crop.x / (1 - sx)) * 100).toFixed(2)}% ${((crop.y / (1 - sy)) * 100).toFixed(2)}%;`;
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
      cfDisplayName,
      cfAvatarHtml,
      cfProfileHref,
      cpUserMenuItems: extra,
      colorfulProfilesReady: true,
      cfEmailVerifyEnabled: aumEnabled ? Boolean(aumEmailVerify(ctx)) : false
    };
  });

  // ------------------------------------------------------------ 资料编辑页
  web.register('get', '/profile/edit', requireLogin, async (req, res) => {
    const user = await ctx.users.findById(req.session.userId!);
    if (!user) return res.status(404).render('error', { title: '用户不存在', message: '当前登录用户不存在。' });
    const profile = (await getProfile(db, user.id)) as (Profile & { email?: string }) | undefined;
    const verify = await getVerifyRow(db, user.id);
    const ev = aumEmailVerify(ctx);
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
      const ev = aumEmailVerify(ctx);
      if (ev) {
        // 先发验证邮件，发送成功后再提交变更，避免用户被置于无法验证的状态。
        const token = randomUUID().replace(/-/g, '');
        const origin = `${req.protocol}://${req.get('host')}`;
        const mail = buildVerificationMail(ev, {
          siteName: getBaseConfig().siteName || 'LinearPress',
          username: user.username,
          verifyUrl: `${origin}/verify?token=${token}`,
          siteUrl: origin
        });
        await sendVerificationMail(ev, sanitized ?? '', mail.subject, mail.html).catch((error: unknown) => { throw new Error(`验证邮件发送失败，邮箱未变更：${messageOf(error)}`); });
        await updateUserEmail(db, userId, sanitized);
        await markEmailPending(db, userId, token, Date.now() + ev.tokenTtlHours * 3600 * 1000);
        needsVerify = true;
      } else {
        await updateUserEmail(db, userId, sanitized);
      }
    }

    // 媒体库头像选择（表单携带 avatar 字段）
    let avatar = text(body.avatar);
    let avatarCrop: string | null = null;
    if (avatar && !avatar.startsWith(AVATAR_STATIC_PREFIX)) {
      // 确认是合法的媒体库或站内图片路径
      if (!/^\/(media-library\/files|uploads|plugins)\//.test(avatar)) avatar = '';
    }
    // 移除头像
    if (text(body.avatar_removed) === '1') { avatar = ''; avatarCrop = ''; }

    const fields: Partial<Profile> = { nickname: nickname || null, website: website || null, bio: bio || null, contact: contact || null, representative: representative || null };
    if (avatar) { fields.avatar = avatar; fields.avatar_crop = null; }
    else if (avatarCrop === '') { fields.avatar = null; fields.avatar_crop = null; }
    await upsertProfile(db, userId, fields);

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
    const posts = await listUserPosts(db, user.id, 0, pageSize, getBaseConfig());
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
    const result = await listUserPosts(db, user.id, offset, limit, getBaseConfig());
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
      saveConfig(ctx.plugins, config);
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
    const ev = aumEmailVerify(ctx);
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
