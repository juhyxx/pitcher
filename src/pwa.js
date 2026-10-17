import { VERSION } from './version.js';

/**
 * Registers the service worker in built versions and offers a reload when a
 * newer build has finished installing in the background.
 */
export async function setupPwa() {
  if (VERSION === 'dev' || !('serviceWorker' in navigator)) return;

  const toast = document.getElementById('update');
  let reloading = false;

  const offerUpdate = (worker) => {
    toast.hidden = false;
    document.getElementById('reload').onclick = () => {
      reloading = true;
      worker.postMessage('skipWaiting');
    };
  };

  // Only reload when the user asked for it; the very first install also
  // changes the controller and must not refresh the page.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });

    // Installed apps can stay open for days; look for a new build on refocus.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}
