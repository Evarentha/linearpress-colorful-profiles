# 多彩个人资料（colorful-profiles）

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-colorful-profiles.svg)](https://www.npmjs.com/package/@evarentha/linearpress-colorful-profiles) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

`colorful-profiles` 是一个 LinearPress 插件，全方位增强用户资料：GIF/APNG 动图头像、全站昵称展示、强制重新验证的邮箱变更，以及附带按月文章时间线的用户资料页。

本插件依赖 `advanced-comments` 与 `advanced-user-management`，且必须排在这两者之后加载。任一依赖缺失时，插件将记录警告并降级运行：缺少 advanced-comments 时文章页失去增强评论区；缺少 advanced-user-management 时，邮箱变更不再强制重新验证。

## 安装

```bash
git clone https://github.com/Evarentha/linearpress-colorful-profiles.git src/plugins/colorful-profiles
```

目录名必须与插件 id 一致，安装后需重启 LinearPress。也可以在 `base` 检出中执行 `sh scripts/sync-plugins.sh colorful-profiles`，或在后台插件页上传 ZIP、填写 npm 包名。请确保两个依赖插件已启用且排序在前：视图优先级跟随加载顺序，本插件的文章视图需在 advanced-comments 的评论区之上叠加头像。

## 头像

GIF 与 APNG 依据魔法字节识别，不依赖扩展名，动画文件伪装为 `.png` 亦无法通过。原始文件无损存储；裁剪在弹窗中通过指针拖拽完成（支持鼠标与触屏），裁剪框始终保持正方形；展示采用 CSS 背景，因此裁剪与渲染均不会破坏动画。默认限制为最长边 1024 像素、文件 10 MB，均可在设置中调整。亦可通过媒体库选择现有文件作为头像，其校验、裁剪、上传流程与全新上传完全一致。

## 资料

资料编辑位于 `/profile/edit`，涵盖头像、昵称、邮箱、网站、Markdown 描述、联系方式与代表作。变更邮箱时账号将被标记为未验证，系统向新地址寄送激活链接，复用 advanced-user-management 的 SMTP 配置与 `/verify` 路由。

资料页 `/user/:username`（需登录）展示上述全部内容，并附带按月分组的文章时间线，经 `GET /api/profiles/:username/posts` 懒加载。`profile:userMenu` Hook 允许其他插件向用户菜单追加条目：

```ts
hooks.on('profile:userMenu', (items) => [...items, { title: '我的收藏', link: '/favorites', icon: '★' }]);
```

## 设置与数据

设置位于 `/admin/colorful-profiles/settings`：两个头像上限、GIF/APNG 开关、时间线每批加载数量、头像子目录（默认 `avatars`，即 `./uploads/avatars/`）。配置以 JSON 形式存储于插件注册表，键为 `colorful-profiles`；`colorful-profiles:manage` 权限守护设置页，资料编辑、头像上传与公开资料页仅需登录。

业务库中有两张表：`colorful_profiles`（昵称、头像与裁剪参数、网站、描述、联系方式、代表作）与 `aum_users`（验证状态；若 advanced-user-management 尚未创建则由本插件创建，双方共用）。`post:beforeSave` Hook 同时拦截未验证用户发布新文章，与 AUM 的评论拦截形成互补。

## 许可证

本项目以 GPL-3.0-or-later 许可发布，Copyright (C) 2026 Evarentha，完整文本见 [LICENSE](LICENSE)。
