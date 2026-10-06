/*
 * Express-Session Type Augmentation
 *
 * Declares req.session.userId, mirroring Base's session types.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Self-contained module typing: declares req.session.userId (consistent with Base
 * src/types/session.d.ts, so the two can coexist without type-merge conflicts).
 *
 * @since 1.0.0
 */

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}