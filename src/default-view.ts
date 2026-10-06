/*
 * LinearPress Default View
 *
 * Implements the default view module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';

/** Theme views are never replaced. Base-only fallbacks preserve profiles UI. */
export function defaultViewFallback(): RequestHandler {
  return (_req, res, next) => {
    const render = res.render.bind(res);
    const defaultOnly = (name: string): boolean => {
      const dirs = res.app.get('views');
      const paths: string[] = Array.isArray(dirs) ? dirs : [dirs];
      const resolved = paths.map(dir => path.resolve(dir, `${name}.ejs`)).find(file => fs.existsSync(file));
      return resolved === path.resolve(process.cwd(), `src/views/${name}.ejs`);
    };
    if (defaultOnly('layouts/web')) res.locals.layout = 'cp-web';
    res.render = ((view: string, ...args: unknown[]) => {
      if (view === 'web/post' && defaultOnly(view)) view = 'cp-post';
      return (render as (...args: unknown[]) => unknown)(view, ...args);
    }) as typeof res.render;
    next();
  };
}
