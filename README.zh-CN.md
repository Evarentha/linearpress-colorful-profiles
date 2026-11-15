# 个人资料

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-colorful-profiles.svg)](https://www.npmjs.com/package/@evarentha/linearpress-colorful-profiles) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

为 LinearPress 用户提供昵称、头像和公开的个人主页。

## 功能

- 昵称、头像（可选取正方形区域；可允许 GIF 和 APNG/动态 WebP）、简介、网站和联系方式。
- 头像和昵称会显示在文章、评论和导航栏中。
- 公开主页 /user/用户名，列出该用户的文章；/user/me 打开自己的主页。
- 用户在 /account/profile 编辑资料和邮箱。

## 入口

- `/admin/profiles`：主页是否公开、头像限制、每页文章数（权限 colorful-profiles:manage）

## 安装

LinearPress 4 已内置。在后台“插件”页启用或停用，立即生效，无需重启。其他安装方式：在 LinearPress 目录执行 `npm run sync -- colorful-profiles`，或把本仓库放到 `src/plugins/colorful-profiles`（目录名必须等于插件 id）。

需要 LinearPress ^4.0.0，支持 SQLite 和 MySQL。

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

源码：https://github.com/Evarentha/linearpress-colorful-profiles
