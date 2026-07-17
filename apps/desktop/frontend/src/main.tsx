/**
 * 桌面 IDE 入口文件
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installBrowserGuards } from './lib/browser-guards';
import './index.css';

if (import.meta.env.PROD) {
  installBrowserGuards();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
