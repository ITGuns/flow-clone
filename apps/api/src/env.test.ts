import { describe, it, expect } from 'vitest';
import { EnvError, REQUIRED_VARS, loadEnv } from './env';

function fullRealEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { MOCK_MODE: '0' };
  for (const key of REQUIRED_VARS) env[key] = `value-${key}`;
  return env;
}

describe('loadEnv — mock mode', () => {
  it('returns mock=true and empty externals with no required vars set', () => {
    const env = loadEnv({ MOCK_MODE: '1' });
    expect(env.mock).toBe(true);
    expect(env.databaseUrl).toBe('');
    expect(env.anthropicApiKey).toBe('');
    expect(env.posthogHost).toBe('');
  });

  it('does not throw even when every required var is absent', () => {
    expect(() => loadEnv({ MOCK_MODE: '1' })).not.toThrow();
  });
});

describe('loadEnv — real mode failure paths', () => {
  it('throws EnvError listing all missing vars when nothing is set', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    try {
      loadEnv({});
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as EnvError).missing).toEqual([...REQUIRED_VARS]);
    }
  });

  it('treats an empty-string required var as missing', () => {
    const env = fullRealEnv();
    env.ANTHROPIC_API_KEY = '';
    try {
      loadEnv(env);
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as EnvError).missing).toEqual(['ANTHROPIC_API_KEY']);
    }
  });

  it('reports only the subset that is missing', () => {
    const env = fullRealEnv();
    delete env.REDIS_URL;
    delete env.TOKEN_INDEX_KEY;
    try {
      loadEnv(env);
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      expect([...(err as EnvError).missing].sort()).toEqual(
        ['REDIS_URL', 'TOKEN_INDEX_KEY'].sort(),
      );
    }
  });
});

describe('loadEnv — real mode success', () => {
  it('returns mock=false and maps every value when all required vars are present', () => {
    const env = loadEnv(fullRealEnv());
    expect(env.mock).toBe(false);
    expect(env.databaseUrl).toBe('value-DATABASE_URL');
    expect(env.tokenIndexKey).toBe('value-TOKEN_INDEX_KEY');
  });
});
