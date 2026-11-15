/*
 * Colorful Profiles Plugin Entry Point
 *
 * Nicknames, avatars (GIF/APNG with square crop) and public profile pages.
 *
 * Authors:
 * MoyuZJ <moyuzj@evarentha.com> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@evarentha.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <p>Nickname, avatar and profile links reach every page through the core
 * filters <code>user.displayName</code>, <code>user.avatar</code> and
 * <code>user.profileUrl</code>, so any theme and any plugin shows them; 3.x
 * replaced the post template and depended on two other plugins.</p>
 * <p>Email changes go through <code>users.updateEmail</code>; a verification
 * plugin decides whether the new address must be confirmed.</p>
 *
 * @since 1.0.0
 */

import path from 'node:path';
import type { Context } from 'cordis';
import type { Request, Response } from 'express';
import { checkPermission, requireAuth, route, text, readMultipart, messageOf, queryPosts, parsePage, utcNow, esc } from 'linearpress/plugin-api';
import type { User } from 'linearpress/plugin-api';
import { AVATAR_ROOT, EXT_BY_KIND, removeAvatar, storeAvatar, validateAvatar } from './src/avatar.js';
import { normalizeConfig, parseSettingsForm, type CpConfig } from './src/config.js';
import { renderMarkdown } from './src/markdown.js';
import { allProfiles, ensureSchema, getProfile, parseCrop, saveProfile, type Profile } from './src/store.js';

const PLUGIN_ID = 'colorful-profiles';
const EDIT = '/account/profile';
const SETTINGS = '/admin/profiles';

export default async function colorfulProfiles(ctx: Context): Promise<void> {
  const { web, ui, admin } = ctx.linearpress;
  const db = () => ctx.databaseService;
  await ensureSchema(db());
  let config: CpConfig = normalizeConfig(await ctx.plugins.getConfig(PLUGIN_ID));

  /* ---------- in-memory view of nicknames and avatars (filters are synchronous) ---------- */
  const profiles = new Map<number, Profile>();
  for (const row of await allProfiles(db())) profiles.set(Number(row.user_id), row);
  const persist = async (profile: Profile) => { profile.updated_at = utcNow(); await saveProfile(db(), profile); profiles.set(profile.user_id, profile); };

  const avatarHtml = (profile: Profile, name: string, size: number) => {
    const crop = parseCrop(profile.avatar_crop);
    let position = 'background-size:cover;background-position:center';
    if (crop) {
      const sx = crop.size; const sy = crop.sizeY ?? crop.size;
      position = `background-size:${(100 / sx).toFixed(2)}% ${(100 / sy).toFixed(2)}%;background-position:${sx >= 0.999 ? 50 : ((crop.x / (1 - sx)) * 100).toFixed(2)}% ${sy >= 0.999 ? 50 : ((crop.y / (1 - sy)) * 100).toFixed(2)}%`;
    }
    return `<span class="avatar cp-avatar" style="--size:${size}px;background-image:url('${esc(profile.avatar)}');${position}" role="img" aria-label="${esc(name)}的头像"></span>`;
  };
  ui.filter('user.displayName', (value: string, who?: Partial<User>) => (who?.id && profiles.get(Number(who.id))?.nickname) || value);
  ui.filter('user.avatar', (html: string, who?: Partial<User>, size = 32) => {
    const profile = who?.id ? profiles.get(Number(who.id)) : undefined;
    return profile?.avatar ? avatarHtml(profile, profile.nickname || who?.username || '', size) : html;
  });
  ui.filter('user.profileUrl', (value: string, who?: Partial<User>) => who?.username ? `/user/${encodeURIComponent(who.username)}` : value);
  ui.menu('user.menu', { title: '我的主页', href: '/user/me', order: 10 });
  ui.menu('user.menu', { title: '编辑资料', href: EDIT, order: 11 });

  /* ---------- avatar files ---------- */
  web.register('get', '/uploads/avatars/:file', (req, res) => {
    const name = path.basename(String(req.params.file));
    if (!/^\d+\.(png|jpg|gif|webp)$/.test(name)) return void res.status(404).end();
    res.sendFile(name, { root: AVATAR_ROOT, maxAge: '365d', immutable: true, headers: { 'X-Content-Type-Options': 'nosniff' } }, (error) => { if (error && !res.headersSent) res.status(404).end(); });
  });

  /* ---------- public profile ---------- */
  web.register('get', '/user/:username', route(async (req: Request, res: Response) => {
    const user = await ctx.users.findByUsername(String(req.params.username));
    if (!user) return void res.status(404).render('error', { pageTitle: '用户不存在', title: '用户不存在', message: '没有找到这个用户，可能已经注销。', code: 404 });
    if (!config.publicProfiles && !req.session.userId) return void res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const profile = profiles.get(user.id) ?? await getProfile(db(), user.id);
    const site = await ctx.config.get();
    const result = await queryPosts(ctx, { options: { type: 'post', status: 'published', conditions: [{ sql: 'posts.author_id = ?', params: [user.id] }] }, list: 'author', query: req.query as Record<string, unknown>, page: parsePage(req.query.page), perPage: config.timelinePageSize, site, base: `/user/${encodeURIComponent(user.username)}` });
    const comments = Number((await db().get<{ n: number }>("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND status = 'approved'", user.id))?.n ?? 0);
    res.render(`${PLUGIN_ID}/profile`, {
      pageTitle: profile.nickname || user.username, profileUser: user, profile, bioHtml: profile.bio ? renderMarkdown(profile.bio) : '',
      posts: result.posts, pager: result.pager, totalPosts: result.total, comments, isSelf: req.session.userId === user.id,
      website: profile.website ? { href: profile.website, label: profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '') } : null
    });
  }));

  // After /user/:username on purpose: the route registered last is tried first.
  web.register('get', '/user/me', requireAuth, route(async (req, res) => {
    const user = await ctx.users.findById(req.session.userId!);
    res.redirect(user ? `/user/${encodeURIComponent(user.username)}` : '/');
  }));

  /* ---------- editing ---------- */
  web.register('get', '/profile/edit', (_req, res) => res.redirect(301, EDIT));
  const renderEdit = async (req: Request, res: Response, form?: { values: Record<string, unknown>; errors: Record<string, string> }, status = 200) => {
    const user = (await ctx.users.findById(req.session.userId!))!;
    const profile = profiles.get(user.id) ?? await getProfile(db(), user.id);
    res.status(status).render(`${PLUGIN_ID}/edit`, {
      pageTitle: '编辑资料', profileUser: user, profile, config,
      form: form ?? { values: { nickname: profile.nickname ?? '', email: user.email ?? '', website: profile.website ?? '', bio: profile.bio ?? '', contact: profile.contact ?? '', representative: profile.representative ?? '', show_email: profile.show_email ? 'on' : '' }, errors: {} }
    });
  };
  web.register('get', EDIT, requireAuth, route(async (req, res) => renderEdit(req, res)));
  web.register('post', EDIT, requireAuth, route(async (req, res) => {
    const userId = req.session.userId!;
    const values = { nickname: text(req.body.nickname).slice(0, 30), email: text(req.body.email), website: text(req.body.website).slice(0, 300), bio: String(req.body.bio ?? '').slice(0, 5000), contact: text(req.body.contact).slice(0, 300), representative: text(req.body.representative).slice(0, 300), show_email: req.body.show_email === 'on' ? 'on' : '' };
    const errors: Record<string, string> = {};
    let website = values.website;
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) errors.website = '网址格式不正确';
    if (values.nickname && /[<>]/.test(values.nickname)) errors.nickname = '昵称不能包含尖括号';
    if (Object.keys(errors).length) return void renderEdit(req, res, { values, errors }, 400);
    const user = (await ctx.users.findById(userId))!;
    let emailNote = '';
    if (values.email !== (user.email ?? '')) {
      try { await ctx.users.updateEmail(userId, values.email || null); emailNote = verificationOn ? ' 新邮箱需要验证，请到“账户与安全”页面发送验证邮件。' : ''; }
      catch (error) { return void renderEdit(req, res, { values, errors: { email: messageOf(error) } }, 400); }
    }
    const profile = { ...(profiles.get(userId) ?? await getProfile(db(), userId)) };
    Object.assign(profile, { nickname: values.nickname || null, website: website || null, bio: values.bio.trim() || null, contact: values.contact || null, representative: values.representative || null, show_email: values.show_email ? 1 : 0 });
    await persist(profile);
    req.flash(emailNote ? 'warning' : 'success', `资料已保存。${emailNote}`);
    res.redirect(303, EDIT);
  }));
  web.register('post', `${EDIT}/avatar`, requireAuth, route(async (req, res) => {
    const userId = req.session.userId!;
    try {
      const form = await readMultipart(req, { maxBytes: config.avatarMaxFileSizeMb * 1024 * 1024 + 64 * 1024, maxFiles: 1, maxParts: 4 });
      const file = form.files[0];
      if (!file) throw new Error('请选择一张图片');
      const info = validateAvatar(file.data, config);
      const crop = parseCrop(form.fields.crop);
      const url = await storeAvatar(userId, file.data, EXT_BY_KIND[info.kind]);
      const profile = { ...(profiles.get(userId) ?? await getProfile(db(), userId)), avatar: url, avatar_crop: crop ? JSON.stringify(crop) : null };
      await persist(profile);
      const user = (await ctx.users.findById(userId))!;
      res.json({ ok: true, html: avatarHtml(profile, profile.nickname || user.username, 96), message: '头像已更新' });
    } catch (error) { res.status(400).json({ ok: false, message: messageOf(error) }); }
  }));
  web.register('post', `${EDIT}/avatar/remove`, requireAuth, route(async (req, res) => {
    const userId = req.session.userId!;
    await removeAvatar(userId);
    await persist({ ...(profiles.get(userId) ?? await getProfile(db(), userId)), avatar: null, avatar_crop: null });
    req.flash('success', '已移除头像。');
    res.redirect(303, EDIT);
  }));

  /* is an email verification plugin active? (only used for a hint) */
  let verificationOn = false;
  const refreshVerification = async () => { const aum = await ctx.plugins.getConfig<{ emailVerify?: { enable?: boolean } }>('advanced-user-management'); verificationOn = Boolean((await ctx.plugins.list()).find((p) => p.id === 'advanced-user-management' && Number(p.enabled)) && aum?.emailVerify?.enable); };
  await refreshVerification();
  ctx.effect(() => { const timer = setInterval(() => void refreshVerification().catch(() => undefined), 60_000); timer.unref?.(); return () => clearInterval(timer); });

  /* ---------- admin ---------- */
  admin.registerSettings({ label: '个人资料', link: SETTINGS, description: '头像限制、资料页是否公开' });
  web.register('get', '/admin/colorful-profiles/settings', (_req, res) => res.redirect(301, SETTINGS));
  web.register('get', SETTINGS, requireAuth, checkPermission('colorful-profiles:manage'), (_req, res) => res.render(`${PLUGIN_ID}/settings`, { pageTitle: '个人资料', crumbs: [{ title: '设置', href: '/admin/settings' }], config }));
  web.register('post', SETTINGS, requireAuth, checkPermission('colorful-profiles:manage'), route(async (req, res) => {
    config = parseSettingsForm(req.body ?? {});
    await ctx.plugins.setConfig(PLUGIN_ID, config);
    req.flash('success', '设置已保存。');
    res.redirect(303, SETTINGS);
  }));

  ctx.logger.info(`activated (${profiles.size} profiles)`);
}
