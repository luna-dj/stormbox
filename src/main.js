import { createApp } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import App from "./App.vue";
import "./assets/styles.css";
import "quill/dist/quill.snow.css";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      console.log('[SW] Service Worker registered:', registration.scope);
      
      // Force update check on every page load (for development)
      await registration.update();
      
      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // New service worker available, force activation
              console.log('[SW] New service worker available, activating...');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            } else {
              // First time install
              console.log('[SW] Service worker installed for the first time');
            }
          }
        });
      });
    } catch (error) {
      console.error('[SW] Service Worker registration failed:', error);
    }
  });
}

const app = createApp(App);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});
app.use(VueQueryPlugin, { queryClient });
app.mount("#app");
