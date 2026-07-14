// Controlled tag-input for a DictionaryEntry's `soundsLike` list (task 4c). Tags are added on Enter or
// comma, removed via each tag's × button or Backspace on an empty field. Purely controlled: it holds
// only the in-progress draft text; the committed tag array lives in the parent.
import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  label: string;
  placeholder?: string;
  /** Optional id for the visible <input>, so a parent <label> can point at it. */
  inputId?: string;
}

export function TagInput({ value, onChange, label, placeholder, inputId }: TagInputProps): ReactElement {
  const [draft, setDraft] = useState('');
  const generatedId = useId();
  const id = inputId ?? generatedId;

  function commitDraft(): void {
    const tag = draft.trim();
    if (tag === '') return;
    if (!value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="uts-tags" data-testid="tag-input">
      {value.map((tag) => (
        <span key={tag} className="uts-tag">
          {tag}
          <button
            type="button"
            className="uts-tag-remove"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            {'×'}
          </button>
        </span>
      ))}
      <input
        id={id}
        className="uts-tag-input"
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
      />
    </div>
  );
}
