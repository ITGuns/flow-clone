import { describe, it, expect } from 'vitest';
import { buildServer } from './index';
import { loadEnv } from './env';

describe('GET /healthz', () => {
  it('returns {ok:true, mock:true} under MOCK_MODE=1', async () => {
    const app = buildServer(loadEnv({ MOCK_MODE: '1' }));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mock: true, speech: 'mock' });
    await app.close();
  });

  it('reflects mock=false when a full real env is supplied', async () => {
    const realEnv = {
      MOCK_MODE: '0',
      DATABASE_URL: 'x',
      REDIS_URL: 'x',
      ANTHROPIC_API_KEY: 'x',
      DEEPGRAM_API_KEY: 'x',
      CLERK_SECRET_KEY: 'x',
      CLERK_PUBLISHABLE_KEY: 'x',
      STRIPE_SECRET_KEY: 'x',
      STRIPE_WEBHOOK_SECRET: 'x',
      TRANSCRIPT_KEY: 'x',
      TOKEN_INDEX_KEY: 'x',
      SESSION_JWT_SECRET: 'x',
    };
    const app = buildServer(loadEnv(realEnv));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true, mock: false, speech: 'real' });
    await app.close();
  });
});
