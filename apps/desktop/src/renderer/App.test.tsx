import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('renders the Undertone wordmark', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Undertone');
  });
});
