// Composition root for the running app — the ONE place the concrete client/capture/api are built
// and handed to <App>. Not imported by any test (tests inject fakes), so importing the shared
// runtime (frame codec) here is fine.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { apiBaseUrl, toWsUrl } from './config';
import { RestApiClient } from './api/client';
import { AudioCapture } from './audio/audio-capture';
import { WebAudioMicSource } from './audio/mic-source';
import { DictationClient, type DictationEvents } from './ws/dictation-client';
import type { DictationDeps } from './dictation/useDictation';

const baseUrl = apiBaseUrl();
const api = new RestApiClient({ baseUrl });

const deps: DictationDeps = {
  createClient: (events: DictationEvents) =>
    new DictationClient({
      wsUrl: toWsUrl(baseUrl),
      tokenProvider: () => api.getSessionToken(),
      events,
    }),
  createCapture: () => new AudioCapture({ source: new WebAudioMicSource() }),
};

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  <StrictMode>
    <App deps={deps} api={api} />
  </StrictMode>,
);
