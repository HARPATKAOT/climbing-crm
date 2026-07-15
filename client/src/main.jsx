import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import PublicHealthForm from './components/PublicHealthForm.jsx';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

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
