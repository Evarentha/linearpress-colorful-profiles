import type { RequestHandler } from 'express';

declare module 'cordis' {
  interface LinearPressWeb {
    register(method: string, path: string, ...handlers: RequestHandler[]): void;
    middleware(handler: RequestHandler): void;
    viewDir(dir: string): void;
    staticDir(dir: string): void;
  }

  interface LinearPressHooks {
    on(name: string, callback: (payload: any) => any, options?: { priority?: number }): void;
    trigger(name: string, payload: any): Promise<any>;
    collect(name: string, initial: any): Promise<any>;
  }

  interface LinearPressDatabase {
    raw: any;
    all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
    get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
    run(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid?: number | bigint; changes?: number | bigint }>;
    exec(sql: string): Promise<void>;
  }

  interface LinearPressAdmin {
    registerMenu(entry: { title: string; link: string; icon?: string }): void;
    registerPanel(html: string): void;
    registerCustomSetting(entry: { label: string; link?: string; html?: string }): void;
  }

  export class Fiber {
    state: number;
    dispose(): Promise<void>;
  }
  export class Context {
    readonly fiber: Fiber;
    reflect: any;
    logger: any;
    linearpress: { web: LinearPressWeb; db: any; hooks: LinearPressHooks; admin: LinearPressAdmin };
    hooks: LinearPressHooks;
    db: any;
    web: LinearPressWeb;
    admin: LinearPressAdmin;
    database: any;
    databaseService: LinearPressDatabase;
    sessionStoreFactory: any;
    auth: any;
    users: any;
    posts: any;
    comments: any;
    groups: any;
    permissions: any;
    plugins: any;
    config: any;
    plugin(callback: ((ctx: Context, config?: unknown) => unknown) | Function): Fiber & PromiseLike<Fiber>;
    effect(effect: () => (() => void | Promise<void>) | void): (() => void) | undefined;
    provide(name: string, value?: unknown): () => void;
    on(name: string, listener: (...args: any[]) => any, options?: unknown): () => boolean;
    emit(name: string, ...args: any[]): void;
  }
}
