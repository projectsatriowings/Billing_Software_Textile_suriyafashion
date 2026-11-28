import crypto from 'node:crypto';
import dns from 'node:dns';
import { createRequire } from 'node:module';

// Configure DNS fallback to handle networks/ISPs that refuse or block cloud endpoints like Neon
const origLookup = dns.lookup;
const resolver = new dns.promises.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

const fallbackLookup: typeof dns.lookup = function (hostname: string, options: any, callback?: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  origLookup(hostname, options, async (err, address, family) => {
    if (err) {
      try {
        const ips = await resolver.resolve4(hostname);
        if (options && options.all) {
          return callback(null, ips.map(ip => ({ address: ip, family: 4 })));
        }
        return callback(null, ips[0], 4);
      } catch {
        return callback(err, address, family);
      }
    }
    return callback(err, address, family);
  });
} as any;

dns.lookup = fallbackLookup;
try {
  const req = createRequire(import.meta.url);
  req('node:dns').lookup = fallbackLookup;
  req('dns').lookup = fallbackLookup;
} catch {}

// Load .env (Node 22 built-in) when present; real environment variables win.
try { process.loadEnvFile('.env'); } catch { /* no .env file: fine */ }

const production = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  if (production) throw new Error('JWT_SECRET must be set in production (use a long random string).');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn(JSON.stringify({ level: 'warn', msg: 'JWT_SECRET not set: using a random one. Everyone is signed out on each restart.' }));
}

export const env = {
  production,
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret,
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 24 * 7),
  developerPasscode: process.env.DEVELOPER_PASSCODE || 'dev@superadmin',
  /** Public base URL used in WhatsApp links. Falls back to the request host. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  staticDir: process.env.STATIC_DIR ?? 'client/dist',
  whatsapp: {
    // Optional: WhatsApp Business Cloud API. Without these the app uses click-to-chat links.
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneId: process.env.WHATSAPP_PHONE_ID ?? '',
    template: process.env.WHATSAPP_TEMPLATE ?? '',
    lang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
  },
  documentAi: {
    projectId: process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID ?? '',
    location: process.env.GOOGLE_DOCUMENT_AI_LOCATION ?? 'us',
    processorId: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID ?? '',
    accessToken: process.env.GOOGLE_DOCUMENT_AI_ACCESS_TOKEN ?? '',
  },
  invoiceRetentionDays: Number(process.env.INVOICE_RETENTION_DAYS ?? 30),
};
