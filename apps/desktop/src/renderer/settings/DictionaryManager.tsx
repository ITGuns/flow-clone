// Dictionary management UI (task 4c) — full CRUD against the `DictionaryApi` port (CONTRACTS.md §5).
// Add a phrase with an optional `soundsLike` tag list; edit or delete existing entries inline. API
// failures render as honest inline copy: 409 → "already have that phrase", 422 → the real 500-entry
// cap, etc. (`dictionaryErrorMessage`). All I/O goes through the injected port, so this whole surface
// tests in jsdom against `FakeDictionaryApi` with no network.
import { useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import type { DictionaryEntry } from '@undertone/shared';
import {
  DictionaryApiError,
  dictionaryErrorMessage,
  type DictionaryApi,
} from './dictionary-api';
import { TagInput } from './TagInput';

export interface DictionaryManagerProps {
  api: DictionaryApi;
}

function toMessage(err: unknown): string {
  if (err instanceof DictionaryApiError) return dictionaryErrorMessage(err);
  return 'Something went wrong. Please try again.';
}

export function DictionaryManager({ api }: DictionaryManagerProps): ReactElement {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [phrase, setPhrase] = useState('');
  const [soundsLike, setSoundsLike] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const phraseId = useId();
  const soundsId = useId();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.list());
      setListError(null);
    } catch (err) {
      setListError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAdd(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setAddError(null);
    try {
      const created = await api.create({
        phrase,
        ...(soundsLike.length > 0 ? { soundsLike } : {}),
      });
      setEntries((prev) => [...prev, created]);
      setPhrase('');
      setSoundsLike([]);
    } catch (err) {
      setAddError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      await api.remove(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setListError(toMessage(err));
    }
  }

  function handleSaved(updated: DictionaryEntry): void {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setEditingId(null);
  }

  return (
    <section className="uts-section" aria-labelledby={`${phraseId}-title`}>
      <h3 id={`${phraseId}-title`} className="uts-section-title">
        Dictionary
      </h3>
      <p className="uts-section-desc">
        Teach Undertone the exact spelling of names and jargon, plus how they get misheard.
      </p>

      <form
        className="uts-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
      >
        <div className="uts-row">
          <div className="uts-row-main">
            <label className="uts-row-label" htmlFor={phraseId}>
              Phrase
            </label>
            <input
              id={phraseId}
              className="uts-input"
              type="text"
              value={phrase}
              placeholder="e.g. Kubernetes"
              onChange={(e) => setPhrase(e.target.value)}
            />
            <p className="uts-hint" id={soundsId}>
              Sounds like (optional) — press Enter to add each mishearing
            </p>
            <TagInput
              value={soundsLike}
              onChange={setSoundsLike}
              label="Sounds like"
              placeholder="e.g. cooper netties"
            />
          </div>
        </div>
        {addError ? (
          <p className="uts-error" role="alert">
            {addError}
          </p>
        ) : null}
        <div className="uts-actions">
          <button type="submit" className="uts-btn uts-btn-primary" disabled={busy || phrase.trim() === ''}>
            {busy ? <span className="uts-spinner" aria-hidden="true" /> : null}
            Add entry
          </button>
        </div>
      </form>

      {listError ? (
        <p className="uts-error" role="alert">
          {listError}
        </p>
      ) : null}

      {loading ? (
        <p className="uts-empty" aria-live="polite">
          Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="uts-empty">No entries yet.</p>
      ) : (
        <ul className="uts-entry-list">
          {entries.map((entry) =>
            editingId === entry.id ? (
              <li key={entry.id} className="uts-entry">
                <EntryEditor
                  entry={entry}
                  api={api}
                  onSaved={handleSaved}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={entry.id} className="uts-entry">
                <div className="uts-row-main">
                  <div className="uts-entry-phrase">{entry.phrase}</div>
                  {entry.soundsLike.length > 0 ? (
                    <div className="uts-entry-sounds">Sounds like: {entry.soundsLike.join(', ')}</div>
                  ) : null}
                </div>
                <div className="uts-actions">
                  <button type="button" className="uts-btn" onClick={() => setEditingId(entry.id)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="uts-btn uts-btn-danger"
                    aria-label={`Delete ${entry.phrase}`}
                    onClick={() => void handleDelete(entry.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

interface EntryEditorProps {
  entry: DictionaryEntry;
  api: DictionaryApi;
  onSaved: (updated: DictionaryEntry) => void;
  onCancel: () => void;
}

function EntryEditor({ entry, api, onSaved, onCancel }: EntryEditorProps): ReactElement {
  const [phrase, setPhrase] = useState(entry.phrase);
  const [soundsLike, setSoundsLike] = useState<string[]>(entry.soundsLike);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.update(entry.id, { phrase, soundsLike });
      onSaved(updated);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uts-row-main">
      <label className="uts-row-label" htmlFor={fieldId}>
        Phrase
      </label>
      <input
        id={fieldId}
        className="uts-input"
        type="text"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
      />
      <TagInput value={soundsLike} onChange={setSoundsLike} label="Sounds like" />
      {error ? (
        <p className="uts-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="uts-actions">
        <button
          type="button"
          className="uts-btn uts-btn-primary"
          disabled={busy || phrase.trim() === ''}
          onClick={() => void save()}
        >
          Save
        </button>
        <button type="button" className="uts-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
