// Style selector → CONTRACTS §1 Register. The chosen style is stamped into every `utterance.start`
// AppContext.register (see useDictation), so it changes how the server formats the next utterance.
import type { JSX } from 'react';
import { STYLE_OPTIONS, type DictationStyle } from '../register';

export interface StyleSelectorProps {
  value: DictationStyle;
  onChange: (style: DictationStyle) => void;
  disabled?: boolean;
}

export function StyleSelector({ value, onChange, disabled }: StyleSelectorProps): JSX.Element {
  return (
    <div className="styles" role="group" aria-label="Formatting style">
      {STYLE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className="styles__opt"
          aria-pressed={value === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          <span className="styles__name">{option.label}</span>
          <span className="styles__hint">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}
