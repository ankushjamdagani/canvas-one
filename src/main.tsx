import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { MotionProvider } from './lib/motion/MotionProvider';
import { ThemeProvider, initializeTheme } from './lib/theme';

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <MotionProvider>
        <App />
      </MotionProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
