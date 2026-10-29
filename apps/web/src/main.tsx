import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './design/index.css';
import { resumeAuth } from './lib/auth';

resumeAuth();  // keep an existing Supabase session's token fresh

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
