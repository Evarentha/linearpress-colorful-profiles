<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# 多彩个人资料（colorful-profiles）

LinearPress 的增强用户资料插件：**GIF/APNG 头像与正方形裁剪、昵称显示、邮箱重验证、
公开资料页（按月时间线）与文章/评论头像展示**；并提供一个可被其它插件扩展的右上角用户菜单。

> 本仓库是 LinearPress 插件 **colorful-profiles** 的独立开发仓库。插件即 Cordis 插件函数，即插即用、可停用可卸载。

## 插件化的优势

- **主题式覆盖友好**：在 `activate` 阶段注册视图目录（`web.viewDir`）覆盖 `layouts/web.ejs` 与 `web/post.ejs`——与 Fluent 主题同机制，谁后激活谁生效，插件页可拖顺序协商。
- **可扩展用户菜单**：其它插件通过 `hooks.on('profile:userMenu', …)` 一行代码接入菜单项（oidc-sso、高级用户管理均这么用）。
- **依赖降级**：依赖 advanced-comments / advanced-user-management，缺失时仍可激活（部分功能降级并输出警告）。

## 功能

- **右上角用户菜单**：头像 + 昵称/@用户名/邮箱 → 「编辑个人资料」→ 其它插件项。
- **资料编辑页** `/profile/edit`：用户名（只读）、昵称、邮箱、头像、网站、描述（Markdown）、联系方式、代表作；改邮箱侵入式提示。
- **头像**：上传 + PC/触屏正方形裁剪；支持 GIF 动态与 APNG（可配置）；原图无损存储（裁剪以坐标 + CSS 呈现，动画不破坏）；默认 ≤1024×1024、≤10MB；存 `./uploads/avatars/`；可改用媒体库。
- **邮箱重验证**：接入 advanced-user-management——改邮箱后置未验证并发送验证邮件（复用其 SMTP 配置与 `/verify` 路由），验证前不可发布文章/评论。
- **公开资料页** `/user/:username`：昵称、头像、网站（自动补 https://）、Markdown 描述、代表作、最近文章**按月时间线**（lazyload，数量可配置）。
- **头像展示位**：文章作者、评论作者、右上角名称、展开菜单内。

## 依赖

| 插件 | 用途 | 缺失影响 |
| --- | --- | --- |
| advanced-comments | 评论视图/评论表单（本插件覆盖文章页并保留其功能） | 文章页不显示评论系统 |
| advanced-user-management | 邮箱验证状态（`aum_users`）与 SMTP 配置 | 邮箱变更不再强制重验证 |

两者未启用时插件仍可激活（部分降级）。建议加载顺序晚于二者（本插件在 activate 阶段注册视图目录，覆盖 `layouts/web.ejs` 与 `web/post.ejs`）。

## 安装

```bash
# 方式一：工作区同步
cd base && sh scripts/sync-plugins.sh colorful-profiles

# 方式二：克隆到运行目录（目录名必须等于插件 id）
git clone <本仓库地址> src/plugins/colorful-profiles
```

## 设置

后台「多彩个人资料」设置页（需 `colorful-profiles:manage`）：头像最大画面边长、最大文件大小、是否允许 GIF/APNG、资料页时间线单次数量、头像存储目录。

## 本地开发：怎么拉 / 怎么改 / 怎么跑

```bash
git clone <本仓库地址> LinearPress/Plugins/colorful-profiles
cd LinearPress/base
npm install && npm run db:init
sh scripts/sync-plugins.sh colorful-profiles
npm run dev
```

## 菜单扩展

```ts
hooks.on('profile:userMenu', (items) => [...items, { title: '我的XX', link: '/my-xx', icon: '✦' }]);
```

## 贡献与发布

- conventional commits；提交前 `cd base && npm run typecheck`
- 版本：`git tag v1.0.0 && git push --tags`
- License：MIT（见仓库 LICENSE）