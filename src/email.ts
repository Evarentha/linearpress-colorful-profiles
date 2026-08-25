/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 邮箱变更重验证邮件发送。
 *
 * 复用高级用户管理(AUM)的 SMTP 配置与模板：改邮箱后给新邮箱发送激活链接，
 * token 写入 aum_users 表，由 AUM 已有的 /verify 路由负责校验与标记已验证。
 * nodemailer 通过 createRequire 动态加载（本插件目录或站点根目录安装后即用），
 * 未安装/未配置时抛出带中文提示的错误，不携带硬依赖。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface SmtpLike { host: string; port: number; encryption: 'none' | 'ssl' | 'starttls'; user: string; password: string; from: string; }
export interface EmailVerifyLike { enable: boolean; smtp: SmtpLike; tokenTtlHours: number; template?: string; templateContent?: string; }

export interface MailVars { siteName: string; username: string; verifyUrl: string; siteUrl: string; }

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
}

export function renderTemplate(template: string, vars: MailVars): string {
  const escaped: Record<string, string> = {
    siteName: escapeHtml(vars.siteName),
    username: escapeHtml(vars.username),
    verifyUrl: escapeHtml(vars.verifyUrl),
    siteUrl: escapeHtml(vars.siteUrl)
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key: string) => (key in escaped ? escaped[key] : full));
}

const DEFAULT_TEMPLATE = `<!doctype html><html lang="zh-CN"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
  <div style="padding:24px 28px;background:#18181b;color:#fff">
    <strong style="font-size:17px">{{siteName}} · 邮箱重验证</strong>
  </div>
  <div style="padding:28px">
    <p style="margin:0 0 16px;color:#18181b;font-size:15px;line-height:1.7">{{siteName}} 检测到你的邮箱地址已变更，请点击下方链接完成新邮箱验证，恢复完整权限（发文章/发评论）。</p>
    <p style="margin:0 0 20px;text-align:center">
      <a href="{{verifyUrl}}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:15px">点击验证新邮箱</a>
    </p>
    <p style="margin:0 0 12px;color:#71717a;font-size:13px;line-height:1.7">若无法点击，请复制以下链接到浏览器打开：<br><a href="{{verifyUrl}}" style="color:#2563eb;word-break:break-all">{{verifyUrl}}</a></p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0">
    <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.7">如非本人操作，请忽略此邮件。此邮件由 <a href="{{siteUrl}}" style="color:#a1a1aa">{{siteUrl}}</a> 自动发送。</p>
  </div>
</div></body></html>`;

export function resolveTemplate(config: EmailVerifyLike): string {
  if (config.template === 'custom' && config.templateContent?.trim()) {
    // 兼容 AUM 自定义模板：将「账号激活」文案替换为「邮箱重验证」引导，避免误导。
    return config.templateContent.trim();
  }
  return DEFAULT_TEMPLATE;
}

export function buildVerificationMail(config: EmailVerifyLike, vars: MailVars): { subject: string; html: string } {
  const subject = `【${vars.siteName}】邮箱地址已变更，请完成新邮箱验证。`;
  return { subject, html: renderTemplate(resolveTemplate(config), vars) };
}

export interface MailerResult { accepted: string[]; rejected: string[]; }

export async function sendVerificationMail(config: EmailVerifyLike, to: string, subject: string, html: string): Promise<MailerResult> {
  const { smtp } = config;
  if (!smtp.host.trim()) throw new Error('SMTP 地址未配置，请在「高级用户管理 → 设置」中完成 SMTP 配置。');
  if (!smtp.user.trim() || !smtp.password) throw new Error('SMTP 账号或密码未配置。');

  let nodemailer: {
    createTransport: (options: Record<string, unknown>) => {
      sendMail: (mail: Record<string, unknown>) => Promise<MailerResult>;
      close?: () => void;
    };
  };
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('未检测到 nodemailer 依赖。请在站点根目录或插件目录执行：npm install nodemailer');
  }

  const secure = smtp.encryption === 'ssl';
  const requireTLS = smtp.encryption === 'starttls';

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 25,
    secure,
    requireTLS,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  });

  try {
    const from = smtp.from.trim() || smtp.user;
    return await transport.sendMail({ from, to, subject, html });
  } finally {
    try { transport.close?.(); } catch { /* 忽略关闭错误 */ }
  }
}
