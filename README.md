# Profiles

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-colorful-profiles.svg)](https://www.npmjs.com/package/@evarentha/linearpress-colorful-profiles) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

Nicknames, avatars and public profile pages for LinearPress.

## Features

- Nickname, avatar (crop a square area; GIF and APNG/animated WebP optional), bio, website and contact.
- Avatars and nicknames appear in posts, comments and the navigation.
- Public profile pages at /user/<username> with the user’s posts; /user/me for your own.
- Users edit their profile and email at /account/profile.

## Where to find it

- `/admin/profiles`: public or members-only profiles, avatar limits, page size (permission colorful-profiles:manage)

## Install

Bundled with LinearPress 4. Enable or disable it on the admin Plugins page; the change applies immediately, no restart. In another checkout, run `npm run sync -- colorful-profiles` from LinearPress, or put this repository at `src/plugins/colorful-profiles` (the directory name must equal the plugin id).

Requires LinearPress ^4.0.0. Works on SQLite and MySQL.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

Source: https://github.com/Evarentha/linearpress-colorful-profiles
