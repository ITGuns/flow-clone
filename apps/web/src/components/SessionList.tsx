// The running list of PREVIOUS utterances this session (the most recent is shown large in the
// result card, so it is excluded here). Newest-first.
import type { JSX } from 'react';
import type { Utterance } from '../dictation/session-state';

export interface SessionListProps {
  utterances: Utterance[];
}

export function SessionList({ utterances }: SessionListProps): JSX.Element | null {
  const previous = utterances.slice(1).filter((u) => u.text !== '' || u.transcript !== '');
  if (previous.length === 0) return null;
  return (
    <section aria-label="Earlier this session">
      <p className="eyebrow">Earlier this session</p>
      <ul className="session">
        {previous.map((u) => (
          <li key={u.id} className="session__item">
            <div className="session__meta">
              <span className="tag">{u.style}</span>
              {u.unformatted ? <span>unformatted</span> : null}
              {u.wordCount > 0 ? <span>{u.wordCount} words</span> : null}
            </div>
            <p className="session__text">{u.text || u.transcript}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
