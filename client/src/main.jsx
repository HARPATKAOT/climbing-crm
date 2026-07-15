import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import PublicHealthForm from './components/PublicHealthForm.jsx';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

// Automatically route all /api calls directly to live cloud Render backend when running on Vercel
const originalFetch = window.fetch;
window.fetch = function (resource, init) {
  if (typeof resource === 'string' && resource.startsWith('/api') && window.location.hostname !== 'localhost') {
    resource = 'https://climbing-crm-api.onrender.com' + resource;
  }
  return originalFetch(resource, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/health" element={<PublicHealthForm />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
