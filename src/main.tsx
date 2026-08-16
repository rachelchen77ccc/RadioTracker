import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { captureMissevanConnect } from './cloud/missevanConnect';
import './styles.css';

captureMissevanConnect();

const Router = import.meta.env.VITE_GITHUB_PAGES === 'true' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <AuthGate><App /></AuthGate>
    </Router>
  </StrictMode>
);
