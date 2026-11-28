import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { DB } from './db/index.ts';
import type { Role } from '../../shared/types.ts';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const bad = (msg: string, code = 'BAD_REQUEST', details?: unknown) => new HttpError(400, code, msg, details);
export const unauthorized = (msg = 'Please sign in again') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do this', code = 'FORBIDDEN', details?: unknown) => new HttpError(403, code, msg, details);
export const notFound = (what = 'Record') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) => new HttpError(409, code, msg, details);

export interface AuthUser {
  id: string;
  tenantId: string;
  name: string;
  role: Role;
  email: string;
  assignedLocation?: string;
  assignedCounter?: string;
  allowedLocations?: string[];
  branchId?: string | null;
  username?: string | null;
  counterId?: string | null;
  mustChangePassword?: boolean;
  isChangeToken?: boolean;
}
export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  db: DB;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  raw: Buffer | null;
  user: AuthUser | null;
  requestId: string;
  ip: string;
  origin: string;
}
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

/** Non-JSON responses. */
export class FileResponse { constructor(public data: Buffer | string, public contentType: string, public filename?: string, public disposition: 'attachment' | 'inline' = 'attachment') { } }
export class HtmlResponse { constructor(public html: string, public status = 200) { } }

interface Route { method: string; re: RegExp; keys: string[]; handlers: Handler[] }

export class Router {
  routes: Route[] = [];
  add(method: string, p: string, ...handlers: Handler[]) {
    const keys: string[] = [];
    const re = new RegExp('^' + p.replace(/:([A-Za-z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get = (p: string, ...h: Handler[]) => this.add('GET', p, ...h);
  post = (p: string, ...h: Handler[]) => this.add('POST', p, ...h);
  put = (p: string, ...h: Handler[]) => this.add('PUT', p, ...h);
  patch = (p: string, ...h: Handler[]) => this.add('PATCH', p, ...h);
  delete = (p: string, ...h: Handler[]) => this.add('DELETE', p, ...h);
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

// ---- tiny in-memory rate limiter (per process; good enough for login and public links)
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const waitMin = Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 60000));
    throw new HttpError(429, 'RATE_LIMITED', `Too many attempts. Please wait ${waitMin} minute${waitMin > 1 ? 's' : ''} and try again.`);
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
}
export function clearRateLimit(key?: string) {
  if (key) hits.delete(key);
  else hits.clear();
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'TOO_LARGE', 'The upload is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

interface CachedFile {
  raw: Buffer;
  gzip: Buffer;
  etag: string;
  mtimeMs: number;
  size: number;
  contentType: string;
}
const staticFileCache = new Map<string, CachedFile>();

function serveStatic(root: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.join(root, path.normalize(rel));
  if (!full.startsWith(path.resolve(root))) return false;
  let file = full;
  let isSpaFallback = false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const publicFallback = path.join(path.resolve('client/public'), path.normalize(rel));
    if (fs.existsSync(publicFallback) && fs.statSync(publicFallback).isFile()) {
      file = publicFallback;
    } else if (path.extname(rel)) {
      return false; // missing asset -> 404
    } else {
      file = path.join(root, 'index.html'); // SPA route
      isSpaFallback = true;
      if (!fs.existsSync(file)) return false;
    }
  }
  const ext = path.extname(file);
  const stat = fs.statSync(file);
  const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

  const isHtml = ext === '.html' || isSpaFallback;
  const isJsOrCss = ext === '.js' || ext === '.css';
  const isIcon = ext === '.ico' || ext === '.png' || ext === '.svg' || ext === '.webmanifest';
  const cacheControl = (isHtml || isJsOrCss || isIcon)
    ? 'no-cache, must-revalidate'
    : 'public, max-age=86400, stale-while-revalidate=604800';

  // 1. Check If-None-Match (HTTP 304 Not Modified)
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, {
      ETag: etag,
      'Cache-Control': cacheControl,
      Vary: 'Accept-Encoding',
    });
    res.end();
    return true;
  }

  // 2. In-memory pre-compressed asset cache (avoids repeated disk I/O & CPU compression)
  let cached = staticFileCache.get(file);
  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    const raw = fs.readFileSync(file);
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const isCompressible = ['.html', '.js', '.css', '.json', '.svg', '.map', '.webmanifest'].includes(ext);
    const gzip = isCompressible ? zlib.gzipSync(raw, { level: 6 }) : raw;
    cached = {
      raw,
      gzip,
      etag,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentType,
    };
    staticFileCache.set(file, cached);
  }

  // 3. Deliver compressed or raw based on client Accept-Encoding
  const acceptEncoding = (req.headers['accept-encoding'] as string) || '';
  const canGzip = acceptEncoding.includes('gzip') && cached.gzip !== cached.raw;

  if (canGzip) {
    res.writeHead(200, {
      'Content-Type': cached.contentType,
      'Content-Encoding': 'gzip',
      'Content-Length': cached.gzip.length,
      'Cache-Control': cacheControl,
      ETag: etag,
      Vary: 'Accept-Encoding',
    });
    res.end(cached.gzip);
  } else {
    res.writeHead(200, {
      'Content-Type': cached.contentType,
      'Content-Length': cached.raw.length,
      'Cache-Control': cacheControl,
      ETag: etag,
      Vary: 'Accept-Encoding',
    });
    res.end(cached.raw);
  }
  return true;
}

export interface ServerOptions { db: DB; router: Router; authenticate: (ctx: Ctx) => Promise<AuthUser | null>; staticDir?: string; log?: boolean }

export function createHandler(opts: ServerOptions): http.RequestListener {
  return async (req, res) => {
    const started = Date.now();
    const requestId = (req.headers['x-request-id'] as string)?.slice(0, 64) || crypto.randomBytes(6).toString('hex');
    const url = new URL(req.url ?? '/', 'http://x');
    const host = req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
    const ctx: Ctx = {
      req, res, db: opts.db, params: {}, query: Object.fromEntries(url.searchParams), body: undefined, raw: null, user: null, requestId,
      ip: ((req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim(),
      origin: `${proto}://${host}`,
    };
    let status = 200;
    const send = (code: number, headers: Record<string, string | number>, data?: Buffer | string) => {
      status = code;
      res.writeHead(code, {
        'X-Request-Id': requestId, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', ...headers,
      });
      res.end(data);
    };
    try {
      const m = opts.router.match(req.method ?? 'GET', url.pathname);
      if (m) {
        ctx.params = m.params;
        const ct = req.headers['content-type'] ?? '';
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
          if (ct.includes('application/json')) {
            const buf = await readBody(req, 25 * 1024 * 1024);
            ctx.raw = buf;
            try { ctx.body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw bad('Request body is not valid JSON', 'BAD_JSON'); }
          } else if (ct.includes('octet-stream')) {
            ctx.raw = await readBody(req, 25 * 1024 * 1024);
          } else ctx.body = {};
        }
        ctx.user = await opts.authenticate(ctx);
        if (ctx.user?.mustChangePassword) {
          const isExcluded = url.pathname === '/api/auth/change-password' || url.pathname === '/api/auth/logout';
          if (!isExcluded) {
            throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required before accessing other resources.');
          }
        }
        let result: unknown;
        for (const h of m.route.handlers) result = await h(ctx);
        if (res.writableEnded || res.headersSent) return;
        if (result instanceof FileResponse) {
          const h: Record<string, string | number> = { 'Content-Type': result.contentType, 'Content-Length': Buffer.byteLength(result.data), 'Cache-Control': 'no-store' };
          if (result.filename) h['Content-Disposition'] = `${result.disposition || 'attachment'}; filename="${result.filename.replace(/[^\w.\-]/g, '_')}"`;
          send(200, h, typeof result.data === 'string' ? Buffer.from(result.data) : result.data);
        } else if (result instanceof HtmlResponse) {
          send(result.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, result.html);
        } else {
          const out = JSON.stringify(result === undefined ? { ok: true } : result);
          const acceptEncoding = (req.headers['accept-encoding'] as string) || '';
          if (out.length > 1024 && acceptEncoding.includes('gzip')) {
            const gzipped = zlib.gzipSync(Buffer.from(out, 'utf8'), { level: 6 });
            send(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Encoding': 'gzip',
              'Content-Length': gzipped.length,
              'Cache-Control': 'no-store',
              Vary: 'Accept-Encoding',
            }, gzipped);
          } else {
            send(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, out);
          }
        }
      } else if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'NOT_FOUND', 'Unknown API route');
      } else if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
        const root = path.resolve(opts.staticDir);
        if (!serveStatic(root, url.pathname, req, res)) send(404, { 'Content-Type': 'text/plain' }, 'Not found');
        else status = 200;
      } else {
        send(404, { 'Content-Type': 'text/plain' }, 'Not found');
      }
    } catch (err: any) {
      let code = 500, body: any = { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId } };
      if (err instanceof HttpError) {
        code = err.status;
        body = { error: { code: err.code, message: err.message, details: err.details, requestId } };
      } else if (err?.code === '23505') {
        code = 409;
        let duplicateMsg = 'This record already exists';
        if (err.constraint === 'invoices_number_uq') {
          duplicateMsg = 'An invoice with this number already exists. Please retry.';
        } else if (err.constraint === 'users_email_uq') {
          duplicateMsg = 'A user with this email address already exists.';
        } else if (err.constraint === 'items_barcode_uq') {
          duplicateMsg = 'A product with this barcode already exists in your catalog.';
        } else if (err.constraint === 'categories_name_uq') {
          duplicateMsg = 'A category with this name already exists.';
        } else if (err.constraint === 'branches_tenant_id_code_key') {
          duplicateMsg = 'A branch with this code already exists.';
        }
        body = { error: { code: 'DUPLICATE', message: duplicateMsg, constraint: err.constraint, requestId } };
      } else if (err?.code === '23503') {
        code = 409;
        body = { error: { code: 'IN_USE', message: 'This record is linked to other records', requestId } };
      } else {
        console.error(JSON.stringify({ level: 'error', rid: requestId, path: url.pathname, error: String(err?.message ?? err), stack: String(err?.stack ?? '').split('\n').slice(0, 5) }));
      }
      if (!res.headersSent) send(code, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(body));
    } finally {
      const isHeartbeatPoll =
        url.pathname === '/api/cfd/heartbeat' ||
        url.pathname === '/api/cfd/update' ||
        url.pathname === '/api/cfd/state' ||
        url.pathname === '/api/scanner/heartbeat' ||
        url.pathname === '/api/scanner/events' ||
        url.pathname === '/api/health';

      if (opts.log !== false && url.pathname.startsWith('/api/') && (!isHeartbeatPoll || status >= 400)) {
        console.log(JSON.stringify({ t: new Date().toISOString(), rid: requestId, m: req.method, p: url.pathname, s: status, ms: Date.now() - started, tenant: ctx.user?.tenantId, user: ctx.user?.id }));
      }
    }
  };
}

// ---- validation helpers: turn bad input into clear 400s
export const V = {
  str(v: unknown, field: string, o: { max?: number; min?: number; required?: boolean } = {}): string {
    if (v === undefined || v === null || v === '') {
      if (o.required) throw bad(`${field} is required`, 'VALIDATION', { field });
      return '';
    }
    if (typeof v !== 'string') throw bad(`${field} must be text`, 'VALIDATION', { field });
    const s = v.trim();
    if (o.required && !s) throw bad(`${field} is required`, 'VALIDATION', { field });
    if (o.min && s.length < o.min) throw bad(`${field} must be at least ${o.min} characters`, 'VALIDATION', { field });
    if (s.length > (o.max ?? 500)) throw bad(`${field} is too long`, 'VALIDATION', { field });
    return s;
  },
  optStr(v: unknown, field: string, max = 500): string | null {
    const s = V.str(v, field, { max });
    return s === '' ? null : s;
  },
  int(v: unknown, field: string, o: { min?: number; max?: number; required?: boolean } = {}): number {
    if (v === undefined || v === null || v === '') {
      if (o.required) throw bad(`${field} is required`, 'VALIDATION', { field });
      return 0;
    }
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${field} must be a whole number`, 'VALIDATION', { field });
    if (n < (o.min ?? -1e13) || n > (o.max ?? 1e13)) throw bad(`${field} is out of range`, 'VALIDATION', { field });
    return n;
  },
  bool(v: unknown, def = false): boolean {
    if (v === undefined || v === null) return def;
    return v === true || v === 'true' || v === 1 || v === '1';
  },
  oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], def?: T): T {
    if ((v === undefined || v === null || v === '') && def !== undefined) return def;
    if (typeof v !== 'string' || !allowed.includes(v as T)) throw bad(`${field} must be one of: ${allowed.join(', ')}`, 'VALIDATION', { field });
    return v as T;
  },
  obj(v: unknown, field: string): Record<string, any> {
    if (v === undefined || v === null) return {};
    if (typeof v !== 'object' || Array.isArray(v)) throw bad(`${field} must be an object`, 'VALIDATION', { field });
    return v as Record<string, any>;
  },
  arr(v: unknown, field: string, o: { min?: number; max?: number } = {}): any[] {
    if (!Array.isArray(v)) throw bad(`${field} must be a list`, 'VALIDATION', { field });
    if (o.min !== undefined && v.length < o.min) throw bad(`${field} needs at least ${o.min} entr${o.min === 1 ? 'y' : 'ies'}`, 'VALIDATION', { field });
    if (v.length > (o.max ?? 1000)) throw bad(`${field} has too many entries`, 'VALIDATION', { field });
    return v;
  },
  date(v: unknown, field: string, required = false): string | null {
    if (v === undefined || v === null || v === '') { if (required) throw bad(`${field} is required`, 'VALIDATION', { field }); return null; }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${field} must be a date like 2026-10-16`, 'VALIDATION', { field });
    return v;
  },
};
