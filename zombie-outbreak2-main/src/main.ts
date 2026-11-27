import '@fontsource/rubik-wet-paint/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './index.css';
import { AppController } from './app/AppController';

const mountNode = document.getElementById('app');
if (!mountNode) {
  throw new Error('Root #app element not found');
}

const app = new AppController(mountNode);

window.addEventListener('beforeunload', () => {
  app.dispose();
});
