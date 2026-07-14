import { describe, it, expect } from 'vitest';
import { InMemoryUserStore } from './memory';
import { syncUser } from './sync-user';

const NOW = new Date('2026-07-14T00:00:00.000Z');
const clock = (): Date => NOW;

describe('syncUser — sync-on-auth (guide §1: 14-day Pro trial)', () => {
  it('provisions a NEW user with plan=pro and trial_ends_at = now + 14 days', async () => {
    const store = new InMemoryUserStore(clock);
    const record = await syncUser(store, { clerkId: 'clerk_new', email: 'new@user.com' }, clock);

    expect(record.clerkId).toBe('clerk_new');
    expect(record.email).toBe('new@user.com');
    expect(record.plan).toBe('pro');
    expect(record.trialEndsAt).not.toBeNull();
    const expected = new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
    expect(record.trialEndsAt?.toISOString()).toBe(expected.toISOString());
    expect(typeof record.id).toBe('string');
  });

  it('does NOT duplicate a returning user — same clerk_id resolves to the same row', async () => {
    const store = new InMemoryUserStore(clock);
    const first = await syncUser(store, { clerkId: 'clerk_ret', email: 'ret@user.com' }, clock);
    const second = await syncUser(store, { clerkId: 'clerk_ret', email: 'ret@user.com' }, clock);

    expect(second.id).toBe(first.id);
    expect(await store.count()).toBe(1);
  });

  it('a returning user keeps their original trial/plan on re-auth (no re-provision)', async () => {
    const store = new InMemoryUserStore(clock);
    // Seed an already-downgraded returning user (trial long over, now on free).
    const seeded = store.seed({
      id: 'u-existing',
      clerkId: 'clerk_old',
      email: 'old@user.com',
      plan: 'free',
      trialEndsAt: new Date('2026-01-01T00:00:00.000Z'),
      stripeCustomerId: null,
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    });
    const resynced = await syncUser(store, { clerkId: 'clerk_old', email: 'old@user.com' }, clock);

    expect(resynced).toEqual(seeded);
    expect(resynced.plan).toBe('free'); // NOT re-granted a fresh trial
    expect(await store.count()).toBe(1);
  });

  it('computes the trial window from the injected clock, not wall time', async () => {
    const fixed = new Date('2030-02-01T12:00:00.000Z');
    const store = new InMemoryUserStore(() => fixed);
    const record = await syncUser(store, { clerkId: 'c', email: 'e@e.com' }, () => fixed);
    expect(record.trialEndsAt?.toISOString()).toBe(
      new Date(fixed.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('concurrent first-auths for the same clerk_id do not create duplicates', async () => {
    const store = new InMemoryUserStore(clock);
    const [a, b] = await Promise.all([
      syncUser(store, { clerkId: 'clerk_race', email: 'r@user.com' }, clock),
      syncUser(store, { clerkId: 'clerk_race', email: 'r@user.com' }, clock),
    ]);
    expect(a.id).toBe(b.id);
    expect(await store.count()).toBe(1);
  });
});
