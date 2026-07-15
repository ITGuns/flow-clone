// Weekly usage meter — words this week vs the plan limit, plus a plan badge. Fed by `usage.update`
// (live) and GET /v1/me (on load). Honest when over the cap (§8 QUOTA_EXCEEDED): the bar turns warm
// and clamps at 100%.
//
// Motion (4j): the fill animates to its new width as usage updates; gated on reduced-motion, in
// which case it snaps to the final width (still exposed via inline style for the tests/a11y).
import type { CSSProperties, JSX } from 'react';
import type { Plan } from '../api/client';
import { motion, useReducedMotion } from '../motion';

export interface UsageMeterProps {
  usage: { wordsThisWeek: number; limit: number } | null;
  plan?: Plan;
}

function format(n: number): string {
  return n.toLocaleString('en-US');
}

export function UsageMeter({ usage, plan }: UsageMeterProps): JSX.Element {
  const reduced = useReducedMotion();
  const words = usage?.wordsThisWeek ?? 0;
  const limit = usage?.limit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((words / limit) * 100)) : 0;
  const over = limit > 0 && words > limit;

  return (
    <div className="usage" aria-label="Weekly usage">
      <div
        className="usage__bar"
        role="progressbar"
        aria-valuenow={words}
        aria-valuemax={limit || undefined}
      >
        <motion.div
          className={`usage__fill${over ? ' is-over' : ''}`}
          style={{ width: `${pct}%` } as CSSProperties}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </div>
      <span className="usage__label">
        {usage ? (
          <>
            {format(words)} / {format(limit)} words this week
          </>
        ) : (
          'Usage loading…'
        )}
      </span>
      {plan ? <span className={`badge${plan === 'pro' ? ' badge--pro' : ''}`}>{plan}</span> : null}
    </div>
  );
}
