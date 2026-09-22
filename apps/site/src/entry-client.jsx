import { StrictMode } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// The prerendered <head> carries this route's tags for crawlers that never run
// JavaScript. Once React is about to take over it manages them itself, so the
// static copies are removed first — otherwise the browser would keep reading
// the first <title> and client-side navigation would never change it.
for (const tag of document.querySelectorAll('[data-seo="static"]')) tag.remove();

const root = document.getElementById('root');
const tree = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// Prerendered pages are hydrated; `npm run dev` renders from scratch.
if (root.hasChildNodes()) hydrateRoot(root, tree);
else createRoot(root).render(tree);
