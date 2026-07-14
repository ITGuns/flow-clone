// drizzle-kit config — `pnpm drizzle-kit generate` diffs src/db/schema.ts against the committed
// meta snapshot and emits SQL under ./drizzle. `generate` needs no DB connection; `dbCredentials`
// is only read by push/introspect commands, which are not part of the committed flow.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
