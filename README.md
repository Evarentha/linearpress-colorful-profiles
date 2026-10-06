# Colorful Profiles

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-colorful-profiles.svg)](https://www.npmjs.com/package/@evarentha/linearpress-colorful-profiles) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

`colorful-profiles` is a plugin for LinearPress that enriches user profiles: animated GIF and APNG avatars, nicknames shown across the site, email changes that force re-verification, and a per-user profile page with a monthly post timeline.

It works independently; `advanced-comments` and `advanced-user-management` are optional enhancements. If either is missing the plugin logs a warning and degrades: without advanced-comments the post page loses the enhanced comment area, and without advanced-user-management email changes stop forcing re-verification.

## Install

```bash
git clone https://github.com/Evarentha/linearpress-colorful-profiles.git src/plugins/colorful-profiles
```

The directory name must equal the plugin id. Restart afterwards, or sync from the `base` checkout (`sh scripts/sync-plugins.sh colorful-profiles`), or upload the ZIP / npm name from the admin Plugins page. Only Base's default post/layout use profile fallbacks; theme templates retain ownership. When Advanced Comments is present its independent partial adds avatars; otherwise a standalone basic comment form is rendered.

## Avatars

GIF and APNG are detected by magic bytes, not by extension, so animated files cannot sneak past as `.png`. The original file is stored losslessly; you crop it in a square, pointer-based modal that works with mouse and touch; display goes through CSS backgrounds, which is why the animation survives both cropping and rendering. Limits default to 1024 pixels on the longest edge and a 10 MB file, both adjustable in settings. You can also pick an existing file from the media library, and it goes through the same validation, crop, and upload chain as a fresh upload.

## Profiles

Editing happens at `/profile/edit`: avatar, nickname, email, website, Markdown description, contact info, representative works. Changing the email marks the account unverified and sends a fresh activation link to the new address, reusing advanced-user-management's SMTP settings and `/verify` route.

The profile page `/user/:username` (login required) shows all of that plus a monthly-grouped post timeline, loaded lazily through `GET /api/profiles/:username/posts`. Avatars appear next to post authors and commenters and in the header user menu. The `profile:userMenu` hook lets other plugins append menu entries:

```ts
hooks.on('profile:userMenu', (items) => [...items, { title: 'My favorites', link: '/favorites', icon: '★' }]);
```

## Settings and data

Settings live at `/admin/colorful-profiles/settings`: the two avatar limits, GIF and APNG toggles, timeline page size, and the avatar subdirectory (default `avatars`, i.e. `./uploads/avatars/`). Configuration is stored as JSON in the plugin registry under `colorful-profiles`, with generic JSON updates taking effect on the next request; `colorful-profiles:manage` guards the settings page, while the profile editor, avatar upload, and the public profile page only require being logged in.

Two tables in the business database: `colorful_profiles` (nickname, avatar and crop parameters, website, description, contact, representative works) and `aum_users` (verification state, created here if advanced-user-management has not created it, and shared with it). A `post:beforeSave` hook also blocks unverified users from publishing new posts, which complements AUM's block on commenting.

## License

GPL-3.0-or-later, Copyright (C) 2026 Evarentha. See LICENSE.
