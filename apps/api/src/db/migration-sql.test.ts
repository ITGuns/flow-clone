// Generated-migration tests — the committed SQL under apps/api/drizzle/ is the artifact deploys
// apply, so assert it directly (no live Postgres). If schema.ts changes without regenerating,
// these fail, forcing `drizzle-kit generate` to be re-run and re-committed.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

const DRIZZLE_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Concatenate every committed *.sql migration into one lower-cased haystack. */
function readAllMigrationSql(): string {
  const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
  return files.map((f) => readFileSync(`${DRIZZLE_DIR}/${f}`, 'utf8')).join('\n');
}

/** Collapse runs of whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

describe('committed migration SQL (§7)', () => {
  let raw: string;
  let sql: string;

  beforeAll(() => {
    raw = readAllMigrationSql();
    sql = normalize(raw);
  });

  it('exists and is non-trivial', () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it('creates every §7 table', () => {
    for (const table of [
      'users',
      'dictionary',
      'transcripts',
      'transcript_tokens',
      'usage_weeks',
      'subscriptions',
    ]) {
      expect(sql).toContain(`create table "${table}"`);
    }
  });

  it('creates the functional UNIQUE(user_id, lower(phrase)) index', () => {
    expect(sql).toContain('create unique index "dictionary_user_lower_phrase_uniq"');
    expect(sql).toMatch(/on "dictionary" using btree \("user_id",\s*lower\("phrase"\)\)/);
  });

  it('creates the transcripts INDEX(user_id, created_at desc)', () => {
    expect(sql).toContain('create index "transcripts_user_created_idx"');
    expect(sql).toMatch(/on "transcripts" using btree \("user_id",\s*"created_at" desc/);
  });

  it('creates the transcript_tokens INDEX(token_hmac)', () => {
    expect(sql).toContain('create index "transcript_tokens_hmac_idx"');
    expect(sql).toMatch(/on "transcript_tokens" using btree \("token_hmac"\)/);
  });

  it('declares the transcript_tokens composite PRIMARY KEY(transcript_id, token_hmac)', () => {
    expect(sql).toMatch(/primary key\("transcript_id","token_hmac"\)/);
  });

  it('declares the usage_weeks composite PRIMARY KEY(user_id, week_start)', () => {
    expect(sql).toMatch(/primary key\("user_id","week_start"\)/);
  });

  it('models ciphertext, iv, and token_hmac as bytea', () => {
    expect(sql).toMatch(/"ciphertext" "bytea" not null/);
    expect(sql).toMatch(/"iv" "bytea" not null/);
    expect(sql).toMatch(/"token_hmac" "bytea" not null/);
  });

  it('constrains clerk_id UNIQUE', () => {
    expect(sql).toMatch(/unique\("clerk_id"\)/);
  });

  it('wires every owned table FK back to users/transcripts with ON DELETE CASCADE', () => {
    for (const table of ['dictionary', 'transcripts', 'usage_weeks', 'subscriptions']) {
      expect(sql).toMatch(
        new RegExp(
          `alter table "${table}" add constraint ".*" foreign key \\("user_id"\\) references "public"."users"\\("id"\\) on delete cascade`,
        ),
      );
    }
    expect(sql).toMatch(
      /alter table "transcript_tokens" add constraint ".*" foreign key \("transcript_id"\) references "public"."transcripts"\("id"\) on delete cascade/,
    );
  });

  it('defaults plan to free and words to 0', () => {
    expect(sql).toMatch(/"plan" text default 'free' not null/);
    expect(sql).toMatch(/"words" integer default 0 not null/);
  });
});
