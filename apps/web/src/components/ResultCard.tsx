// The centrepiece result card: live partial while speaking, formatted text as it streams, a one-
// click Copy, word count, and the §8 honest notes (raw-fallback "unformatted", quota upgrade hint).
//
// Motion (4j): the card rises + fades in on a new utterance; the live partial fades in word-by-word
// as it streams; the Copy button morphs its icon to a success tick. All gated on reduced-motion —
// the copy behaviour and rendered text are byte-identical either way.
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Utterance } from '../dictation/session-state';
import { copyText, type ClipboardLike } from './copy';
import { CopyIcon } from './icons';
import { CheckIcon } from '../assets/icons';
import { AnimatePresence, motion, rise, tick, word, useReducedMotion } from '../motion';

export interface ResultCardProps {
  utterance: Utterance | null;
  /** Injected in tests; defaults to the real clipboard writer. */
  copy?: (text: string) => Promise<boolean>;
  clipboard?: ClipboardLike;
}

function statusLabel(u: Utterance): string {
  switch (u.phase) {
    case 'recording':
      return 'Listening';
    case 'transcribing':
      return 'Transcribing';
    case 'formatting':
      return 'Formatting';
    case 'error':
      return 'Error';
    case 'done':
      return u.unformatted ? 'Unformatted' : 'Ready';
  }
}

/** Split into words that each retain a trailing space, so joined text is unchanged. */
function toWords(text: string): string[] {
  return text.length === 0 ? [] : (text.match(/\S+\s*|\s+/g) ?? [text]);
}

export function ResultCard({ utterance, copy, clipboard }: ResultCardProps): JSX.Element {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const doCopy = useCallback(
    async (text: string): Promise<void> => {
      const ok = await (copy ? copy(text) : copyText(text, clipboard));
      if (!ok) return;
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    },
    [copy, clipboard],
  );

  if (!utterance) {
    return (
      <div className="result result--empty">
        <p style={{ margin: 0 }}>Hold to talk and your polished text lands here.</p>
      </div>
    );
  }

  const u = utterance;
  const showPartial = u.phase === 'recording' || u.phase === 'transcribing';
  const body = u.text !== '' ? u.text : showPartial ? u.partial : '';
  const canCopy = u.text !== '';
  const asPartial = body === u.partial && showPartial;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div className="result" key={u.id} {...rise(reduced)}>
        <div className="result__head">
          <span className="result__status">{statusLabel(u)}</span>
          <span className="tag">{u.style}</span>
          <span className="result__spacer" />
          {u.phase === 'done' && u.wordCount > 0 ? (
            <span className="result__count">
              {u.wordCount} word{u.wordCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {canCopy ? (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => void doCopy(u.text)}
            >
              <span className="result__copyicon" aria-hidden="true">
                <AnimatePresence mode="wait" initial={false}>
                  {copied ? (
                    <motion.span key="done" className="result__copyicon-in" {...tick(reduced)}>
                      <CheckIcon />
                    </motion.span>
                  ) : (
                    <motion.span key="idle" className="result__copyicon-in" {...tick(reduced)}>
                      <CopyIcon />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </div>

        <p className={`result__text${asPartial ? ' result__partial' : ''}`}>
          {body === ''
            ? showPartial
              ? 'Listening…'
              : ''
            : asPartial && !reduced
              ? toWords(body).map((w, i) => (
                  <motion.span key={i} className="result__word" {...word(reduced)}>
                    {w}
                  </motion.span>
                ))
              : body}
        </p>

        {u.phase === 'error' && u.errorMessage ? (
          <div className="result__note result__note--warn" role="alert">
            <strong>Something went wrong.</strong> {u.errorMessage}
          </div>
        ) : null}

        {u.unformatted && u.phase === 'done' ? (
          <div className="result__note result__note--warn">
            <strong>Unformatted.</strong> Formatting was unavailable, so your raw transcript is
            shown — your words were never lost.
          </div>
        ) : null}

        {u.quotaExceeded ? (
          <div className="result__note result__note--warn">
            <strong>Weekly limit reached.</strong> This result is yours to keep. Upgrade to Pro for
            more words each week.
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
