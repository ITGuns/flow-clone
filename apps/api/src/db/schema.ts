// Drizzle + Postgres schema — CONTRACTS.md §7 (this file is law; implemented EXACTLY).
//
// This module is the foundational data layer (Task 3b). It defines the tables only; it does NOT
// implement history/dictionary/billing logic — those live in tasks 3a/3c/3d/3e/3f and build on
// these definitions.
//
// Nullability & defaults note: §7 annotates only pk / uniq / fk / column types. Where a column is
// clearly required identity or content (clerk_id, email, ciphertext, iv, register, …) it is
// NOT NULL; columns populated later by billing/trial logic (trial_ends_at, stripe_customer_id,
// subscription.*) stay nullable. DB-level defaults added below are additive conveniences that a
// caller may always override: plan → 'free' (the §1 base tier), created_at/updated_at → now(),
// usage_weeks.words → 0, dictionary.sounds_like → '{}'. FKs cascade on delete so the owner row
// (users, and transcripts→transcript_tokens) cleans up its dependents — this backs the §5
// DELETE /v1/history and account-deletion paths. None of this alters the §7 column set.
import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Register } from '@undertone/shared';

// ── Allowed-value unions (text columns with documented enums, exported for reuse) ────────────
// `plan` and `register` are stored as plain Postgres `text` (not native enums) per §7, with the
// allowed values pinned here as `const` tuples so both the Drizzle column type and downstream TS
// gain a narrowed union. REGISTER_VALUES is checked against @undertone/shared's `Register` (the
// §1 union) at the type level below and by an exhaustiveness test in schema.test.ts.

/** Allowed `users.plan` values — §7 `plan text ('free'|'pro')`, §1 pricing tiers. */
export const PLAN_VALUES = ['free', 'pro'] as const;
export type Plan = (typeof PLAN_VALUES)[number];

/** Allowed `transcripts.register` values — the §1 `Register` union. */
export const REGISTER_VALUES = [
  'chat',
  'email',
  'code',
  'document',
  'terminal',
  'unknown',
] as const;
export type RegisterValue = (typeof REGISTER_VALUES)[number];

// Compile-time proof that REGISTER_VALUES is exactly the shared `Register` union (both ways):
// if either drifts, one of these assignments stops type-checking.
const _registerCoversShared: Register = 'chat' as RegisterValue;
const _sharedCoversRegister: RegisterValue = 'chat' as Register;
void _registerCoversShared;
void _sharedCoversRegister;

// ── Postgres `bytea` custom type (drizzle-orm/pg-core has no built-in bytea) ──────────────────
// Encrypted transcript payloads and HMAC token digests are raw bytes; modeled as Node Buffers.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ── users ─────────────────────────────────────────────────────────────────────────────────────
// §7: id uuid pk · clerk_id text uniq · email text · plan text ('free'|'pro')
//     · trial_ends_at timestamptz · stripe_customer_id text · created_at
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  plan: text('plan', { enum: PLAN_VALUES }).notNull().default('free'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── dictionary ─────────────────────────────────────────────────────────────────────────────────
// §7: id uuid pk · user_id fk · phrase text · sounds_like text[] · created_at
//     · UNIQUE(user_id, lower(phrase))   ← functional unique index
export const dictionary = pgTable(
  'dictionary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phrase: text('phrase').notNull(),
    soundsLike: text('sounds_like')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dictionary_user_lower_phrase_uniq').on(t.userId, sql`lower(${t.phrase})`)],
);

// ── transcripts ─────────────────────────────────────────────────────────────────────────────────
// §7: id uuid pk · user_id fk · ciphertext bytea · iv bytea · key_version int · app_name text
//     · register text · word_count int · created_at · INDEX (user_id, created_at desc)
export const transcripts = pgTable(
  'transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    keyVersion: integer('key_version').notNull(),
    appName: text('app_name').notNull(),
    register: text('register', { enum: REGISTER_VALUES }).notNull(),
    wordCount: integer('word_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transcripts_user_created_idx').on(t.userId, t.createdAt.desc())],
);

// ── transcript_tokens ────────────────────────────────────────────────────────────────────────
// §7: transcript_id fk · token_hmac bytea · PRIMARY KEY(transcript_id, token_hmac) · INDEX (token_hmac)
export const transcriptTokens = pgTable(
  'transcript_tokens',
  {
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => transcripts.id, { onDelete: 'cascade' }),
    tokenHmac: bytea('token_hmac').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transcriptId, t.tokenHmac] }),
    index('transcript_tokens_hmac_idx').on(t.tokenHmac),
  ],
);

// ── usage_weeks ────────────────────────────────────────────────────────────────────────────────
// §7: user_id fk · week_start date · words int · PRIMARY KEY(user_id, week_start)
export const usageWeeks = pgTable(
  'usage_weeks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    words: integer('words').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
);

// ── subscriptions ────────────────────────────────────────────────────────────────────────────
// §7: user_id pk fk · stripe_sub_id text · status text · plan_interval text
//     · current_period_end timestamptz · updated_at
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeSubId: text('stripe_sub_id'),
  status: text('status'),
  planInterval: text('plan_interval'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The full schema object, handed to `drizzle(sql, { schema })` for relational typing. */
export const schema = {
  users,
  dictionary,
  transcripts,
  transcriptTokens,
  usageWeeks,
  subscriptions,
};

// Row inference helpers for downstream tasks (select / insert shapes).
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DictionaryRow = typeof dictionary.$inferSelect;
export type NewDictionaryRow = typeof dictionary.$inferInsert;
export type TranscriptRow = typeof transcripts.$inferSelect;
export type NewTranscriptRow = typeof transcripts.$inferInsert;
export type TranscriptTokenRow = typeof transcriptTokens.$inferSelect;
export type NewTranscriptTokenRow = typeof transcriptTokens.$inferInsert;
export type UsageWeekRow = typeof usageWeeks.$inferSelect;
export type NewUsageWeekRow = typeof usageWeeks.$inferInsert;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
