/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 多彩个人资料插件配置模型。
 *
 * 配置整体以 JSON 保存在插件注册表（ctx.plugins.getConfig/setConfig）。
 * 本模块不依赖 Base 内部实现，只依赖 Cordis Context 暴露的 plugins 服务，
 * 支持默认值 + 浅层合并，保证字段缺失时行为可预期。
 */

/** 插件注册表配置服务的最小接口（由 ctx.plugins 满足）。 */
export interface PluginConfigService {
  getConfig<T = unknown>(id: string): T | null;
  setConfig(id: string, config: unknown): void;
}

export interface CpConfig {
  /** 头像最大边长（像素），默认 1024 */
  avatarSizeLimitPx: number;
  /** 头像最大文件大小（MB），默认 10 */
  avatarMaxFileSizeMb: number;
  /** 是否允许 GIF 动态头像 */
  allowGif: boolean;
  /** 是否允许动态 PNG（APNG）头像 */
  allowApng: boolean;
  /** 个人资料页文章时间线 lazyload 单次加载数量，默认 10 */
  timelinePageSize: number;
  /** 头像上传子目录（相对站点 uploads 根） */
  avatarDir: string;
}

const DEFAULT_CONFIG: CpConfig = {
  avatarSizeLimitPx: 1024,
  avatarMaxFileSizeMb: 10,
  allowGif: true,
  allowApng: true,
  timelinePageSize: 10,
  avatarDir: 'avatars'
};

export function getDefaultConfig(): CpConfig {
  return { ...DEFAULT_CONFIG, avatarDir: 'avatars' };
}

function asNumber(value: unknown, fallback: number, min = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** 合并用户配置到默认值；未知字段忽略，非法数值回退。 */
export function normalizeConfig(raw: unknown): CpConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const defaults = getDefaultConfig();
  return {
    avatarSizeLimitPx: asNumber(input.avatarSizeLimitPx, defaults.avatarSizeLimitPx, 1),
    avatarMaxFileSizeMb: asNumber(input.avatarMaxFileSizeMb, defaults.avatarMaxFileSizeMb, 1),
    allowGif: asBoolean(input.allowGif, defaults.allowGif),
    allowApng: asBoolean(input.allowApng, defaults.allowApng),
    timelinePageSize: asNumber(input.timelinePageSize, defaults.timelinePageSize, 1),
    avatarDir: asString(input.avatarDir, defaults.avatarDir).replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || defaults.avatarDir
  };
}

export function loadConfig(plugins: PluginConfigService): CpConfig {
  return normalizeConfig(plugins.getConfig<unknown>('colorful-profiles'));
}

export function saveConfig(plugins: PluginConfigService, config: CpConfig): void {
  plugins.setConfig('colorful-profiles', config);
}

/** 从设置页表单构建配置（checkbox 为 on/undefined，数字为空回退默认）。 */
export function parseSettingsForm(body: Record<string, unknown>): CpConfig {
  const checkbox = (value: unknown): boolean => value === 'on' || value === '1' || value === true;
  return normalizeConfig({
    avatarSizeLimitPx: Number(body.avatar_size_limit) || undefined,
    avatarMaxFileSizeMb: Number(body.avatar_max_size_mb) || undefined,
    allowGif: checkbox(body.allow_gif),
    allowApng: checkbox(body.allow_apng),
    timelinePageSize: Number(body.timeline_page_size) || undefined,
    avatarDir: String(body.avatar_dir ?? '')
  });
}
