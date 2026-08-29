<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# 多彩个人资料 · Colorful Profiles

User-profile enhancement for LinearPress：**GIF/APNG avatars with square cropping, display nicknames, email re-verification, public profile pages（monthly timeline）and avatar displays in posts/comments** — plus an extensible top-right user menu.

LinearPress 的增强用户资料插件：**GIF/APNG 头像与正方形裁剪、昵称显示、邮箱重验证、公开资料页（按月时间线）与文章/评论头像展示**；并提供一个可被其它插件扩展的右上角用户菜单。

> Independent plugin repository for LinearPress **colorful-profiles**. A plugin is a Cordis plugin function — install on demand, disable/uninstall cleanly.
> 本仓库是 LinearPress 插件 **colorful-profiles** 的独立仓库。

## Why Plugins? / 插件化的优势

- **Theme-friendly overrides** —— registers its views via `web.viewDir()` in the activate phase（same mechanism as the Fluent theme）; whoever activates later wins, adjustable by `load_order`.
  **主题式覆盖友好**——activate 阶段注册视图目录，与 Fluent 主题同机制，谁后激活谁生效。
- **Extensible user menu** —— other plugins add items with one line: `hooks.on('profile:userMenu', …)`（used by oidc-sso and advanced-user-management）.
  **可扩展用户菜单**——其它插件一行接入菜单项。
- **Graceful dependency degradation** —— works without its suggested dependencies（with warnings）.
  **依赖降级**。

## Features / 功能

- **User menu / 右上角用户菜单**：avatar + nickname/@username/email →「编辑个人资料」→ plugin items.
- **Profile edit / 资料编辑页** `/profile/edit`：username（read-only）、nickname、email、avatar、website、Markdown description、contact、featured work；invasive email-change confirm.
- **Avatars / 头像**：upload + square crop（PC/touch）；GIF & APNG support（configurable）；lossless original（crop by coords + CSS）；default ≤1024×1024、≤10MB；stored in `./uploads/avatars/`；media-library optional.
- **Email re-verification / 邮箱重验证**：integrates advanced-user-management（its SMTP config & `/verify` route）; unverified users can't publish/comment.
- **Public profile / 公开资料页** `/user/:username`：nickname, avatar, website（auto https://）, Markdown description, featured work, recent posts **monthly timeline**（lazyload）.
- **Avatar placements / 头像展示位**：post author, comment author, header menu.

## Dependencies / 依赖

| Plugin / 插件 | Purpose / 用途 | Without it / 缺失影响 |
| --- | --- | --- |
| advanced-comments | comment views（this plugin overrides the article page & keeps its features） | no comment system on article pages |
| advanced-user-management | email-verification status & SMTP config | no forced re-verification |

Recommended order：activate AFTER both（it registers view dirs in activate phase）.

## Install / 安装

```bash
# Option 1 — workspace sync（工作区同步）
cd base && sh scripts/sync-plugins.sh colorful-profiles

# Option 2 — clone into runtime dir（目录名必须等于插件 id）
git clone https://github.com/Evarentha/linearpress-colorful-profiles src/plugins/colorful-profiles
```

## Settings / 设置

Admin「多彩个人资料」page（needs `colorful-profiles:manage`）：avatar max side（px）、max file size（MB）、GIF/APNG toggles、timeline batch size、avatar storage dir.

## Local Development / 本地开发：怎么拉 / 怎么改 / 怎么跑

```bash
git clone https://github.com/Evarentha/linearpress-colorful-profiles LinearPress/Plugins/colorful-profiles
cd LinearPress/base
npm install && npm run db:init
sh scripts/sync-plugins.sh colorful-profiles
npm run dev
```

## Menu Extension / 菜单扩展

```ts
hooks.on('profile:userMenu', (items) => [...items, { title: 'My Items', link: '/my-items', icon: '✦' }]);
```

## Contribute & Release / 贡献与发布

- conventional commits；`cd base && npm run typecheck` before commit
- Version：`git tag v1.0.0 && git push --tags`
- License：MIT（LICENSE）