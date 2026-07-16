// Schema-shape tests — assert the Drizzle table definitions match CONTRACTS §7 EXACTLY, without a
// live Postgres. Uses drizzle-orm's `getTableConfig` to introspect columns / pks / fks / indexes.
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Register } from '@undertone/shared';
import {
  PLAN_VALUES,
  REGISTER_VALUES,
  dictionary,
  subscriptions,
  transcriptTokens,
  transcripts,
  usageWeeks,
  users,
} from './schema';

/** Map a table's columns by SQL name → its introspected config for concise assertions. */
function columnsByName(table: Parameters<typeof getTableConfig>[0]) {
  const cfg = getTableConfig(table);
  return new Map(cfg.columns.map((c) => [c.name, c]));
}

describe('allowed-value unions', () => {
  it('PLAN_VALUES is exactly the §7 plan enum', () => {
    expect([...PLAN_VALUES]).toEqual(['free', 'pro']);
  });

  it('REGISTER_VALUES is exactly the §1 Register union (order-independent)', () => {
    expect([...REGISTER_VALUES].sort()).toEqual(
      ['chat', 'code', 'document', 'email', 'terminal', 'unknown'].sort(),
    );
  });

  it('REGISTER_VALUES is assignment-compatible with the shared Register type both ways', () => {
    // Compile-time exhaustiveness: a Record keyed by every Register must accept exactly the
    // REGISTER_VALUES members. If either side drifts this stops type-checking (and the test file
    // fails to build), so the runtime body is a trivial presence check.
    const coverage: Record<Register, true> = {
      chat: true,
      email: true,
      code: true,
      document: true,
      terminal: true,
      unknown: true,
    };
    for (const value of REGISTER_VALUES) {
      expect(coverage[value]).toBe(true);
    }
    expect(Object.keys(coverage).length).toBe(REGISTER_VALUES.length);
  });
});

describe('users table (§7)', () => {
  const cols = columnsByName(users);
  const cfg = getTableConfig(users);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(
      [
        'id',
        'clerk_id',
        'email',
        'plan',
        'trial_ends_at',
        'stripe_customer_id',
        'created_at',
      ].sort(),
    );
  });

  it('id is a uuid primary key', () => {
    expect(cols.get('id')?.primary).toBe(true);
    expect(cols.get('id')?.dataType).toBe('string');
    expect(cols.get('id')?.getSQLType()).toBe('uuid');
  });

  it('clerk_id is NOT NULL and uniquely constrained', () => {
    expect(cols.get('clerk_id')?.notNull).toBe(true);
    expect(cols.get('clerk_id')?.isUnique).toBe(true);
  });

  it('email is NOT NULL text', () => {
    expect(cols.get('email')?.notNull).toBe(true);
    expect(cols.get('email')?.getSQLType()).toBe('text');
  });

  it('plan defaults to free and carries the enum union', () => {
    expect(cols.get('plan')?.notNull).toBe(true);
    expect(cols.get('plan')?.default).toBe('free');
    expect(cols.get('plan')?.enumValues).toEqual([...PLAN_VALUES]);
  });

  it('trial_ends_at and stripe_customer_id are nullable', () => {
    expect(cols.get('trial_ends_at')?.notNull).toBe(false);
    expect(cols.get('stripe_customer_id')?.notNull).toBe(false);
  });

  it('trial_ends_at / created_at are timestamptz', () => {
    expect(cols.get('trial_ends_at')?.getSQLType()).toBe('timestamp with time zone');
    expect(cols.get('created_at')?.getSQLType()).toBe('timestamp with time zone');
  });

  it('has no foreign keys', () => {
    expect(cfg.foreignKeys).toHaveLength(0);
  });
});

describe('dictionary table (§7)', () => {
  const cols = columnsByName(dictionary);
  const cfg = getTableConfig(dictionary);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(
      ['id', 'user_id', 'phrase', 'sounds_like', 'created_at'].sort(),
    );
  });

  it('id is a uuid primary key', () => {
    expect(cols.get('id')?.primary).toBe(true);
    expect(cols.get('id')?.getSQLType()).toBe('uuid');
  });

  it('sounds_like is a NOT NULL text array', () => {
    expect(cols.get('sounds_like')?.notNull).toBe(true);
    expect(cols.get('sounds_like')?.getSQLType()).toBe('text[]');
  });

  it('user_id is a FK to users.id with cascade delete', () => {
    expect(cfg.foreignKeys).toHaveLength(1);
    const ref = cfg.foreignKeys[0]?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(['user_id']);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(['id']);
    expect(ref?.foreignTable).toBe(users);
    expect(cfg.foreignKeys[0]?.onDelete).toBe('cascade');
  });

  it('declares the functional UNIQUE(user_id, lower(phrase)) index', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'dictionary_user_lower_phrase_uniq');
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
    // Two columns in the index: the plain user_id and a SQL expression over phrase.
    expect(idx?.config.columns).toHaveLength(2);
  });
});

describe('transcripts table (§7)', () => {
  const cols = columnsByName(transcripts);
  const cfg = getTableConfig(transcripts);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(
      [
        'id',
        'user_id',
        'ciphertext',
        'iv',
        'key_version',
        'app_name',
        'register',
        'word_count',
        'created_at',
      ].sort(),
    );
  });

  it('ciphertext and iv are bytea', () => {
    expect(cols.get('ciphertext')?.getSQLType()).toBe('bytea');
    expect(cols.get('iv')?.getSQLType()).toBe('bytea');
    expect(cols.get('ciphertext')?.notNull).toBe(true);
    expect(cols.get('iv')?.notNull).toBe(true);
  });

  it('key_version and word_count are integers', () => {
    expect(cols.get('key_version')?.getSQLType()).toBe('integer');
    expect(cols.get('word_count')?.getSQLType()).toBe('integer');
  });

  it('register is text carrying the Register union', () => {
    expect(cols.get('register')?.getSQLType()).toBe('text');
    expect(cols.get('register')?.enumValues).toEqual([...REGISTER_VALUES]);
    expect(cols.get('register')?.notNull).toBe(true);
  });

  it('user_id is a FK to users.id', () => {
    const ref = cfg.foreignKeys[0]?.reference();
    expect(ref?.foreignTable).toBe(users);
    expect(ref?.columns.map((c) => c.name)).toEqual(['user_id']);
  });

  it('declares the INDEX(user_id, created_at desc)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'transcripts_user_created_idx');
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(false);
    expect(idx?.config.columns).toHaveLength(2);
  });
});

describe('transcript_tokens table (§7)', () => {
  const cols = columnsByName(transcriptTokens);
  const cfg = getTableConfig(transcriptTokens);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(['transcript_id', 'token_hmac'].sort());
  });

  it('token_hmac is bytea', () => {
    expect(cols.get('token_hmac')?.getSQLType()).toBe('bytea');
  });

  it('has a composite PRIMARY KEY(transcript_id, token_hmac)', () => {
    expect(cfg.primaryKeys).toHaveLength(1);
    expect(cfg.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['transcript_id', 'token_hmac']);
  });

  it('transcript_id is a FK to transcripts.id with cascade delete', () => {
    const fk = cfg.foreignKeys[0];
    expect(fk?.reference().foreignTable).toBe(transcripts);
    expect(fk?.onDelete).toBe('cascade');
  });

  it('declares the INDEX(token_hmac)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'transcript_tokens_hmac_idx');
    expect(idx).toBeDefined();
    expect(idx?.config.columns).toHaveLength(1);
  });
});

describe('usage_weeks table (§7)', () => {
  const cols = columnsByName(usageWeeks);
  const cfg = getTableConfig(usageWeeks);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(['user_id', 'week_start', 'words'].sort());
  });

  it('week_start is a date and words defaults to 0', () => {
    expect(cols.get('week_start')?.getSQLType()).toBe('date');
    expect(cols.get('words')?.getSQLType()).toBe('integer');
    expect(cols.get('words')?.default).toBe(0);
  });

  it('has a composite PRIMARY KEY(user_id, week_start)', () => {
    expect(cfg.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['user_id', 'week_start']);
  });
});

describe('subscriptions table (§7)', () => {
  const cols = columnsByName(subscriptions);
  const cfg = getTableConfig(subscriptions);

  it('has exactly the §7 columns', () => {
    expect([...cols.keys()].sort()).toEqual(
      [
        'user_id',
        'stripe_sub_id',
        'status',
        'plan_interval',
        'current_period_end',
        'updated_at',
      ].sort(),
    );
  });

  it('user_id is the primary key AND a FK to users.id', () => {
    expect(cols.get('user_id')?.primary).toBe(true);
    const fk = cfg.foreignKeys[0];
    expect(fk?.reference().foreignTable).toBe(users);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(['user_id']);
  });

  it('stripe/status/interval/period columns are nullable; updated_at is not', () => {
    expect(cols.get('stripe_sub_id')?.notNull).toBe(false);
    expect(cols.get('status')?.notNull).toBe(false);
    expect(cols.get('plan_interval')?.notNull).toBe(false);
    expect(cols.get('current_period_end')?.notNull).toBe(false);
    expect(cols.get('updated_at')?.notNull).toBe(true);
  });
});
