/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * 独立模块类型自足：声明 req.session.userId（与 Base src/types/session.d.ts 保持一致，
 * 二者并存时类型合并不冲突）。
 */

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}