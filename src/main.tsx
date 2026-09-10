import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HostApp } from './host/HostApp';
import './styles.css';
import './magic-chat/magic-chat.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HostApp />
  </StrictMode>,
);
