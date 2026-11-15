// The phone desk's switch for a buzz on this phone (`#lib/server/push.ts`).
// On, the phone asks for leave to show notifications, registers the desk's
// service worker (`static/desk-push.js`) for /desk alone, asks its own push
// service for an address with the office's key, and gives the office that
// address. Off undoes each step.
import { call } from './api.ts';

/**
 * Where this phone stands: `cannot` when its browser has no push (an iPhone's
 * Safari until the desk is on the home screen), `blocked` when the owner said
 * no to notifications in the phone's settings, else `off` or `on`.
 */
export type BuzzState = 'cannot' | 'blocked' | 'off' | 'on';

const WORKER = '/desk-push.js';
const SCOPE = '/desk';

const canPush = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function buzzState(): Promise<BuzzState> {
  if (!canPush()) return 'cannot';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

/** The office's key as the push service takes it. */
function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn the buzz on. Must run from the owner's tap: a phone asks leave only then. */
export async function buzzOn(): Promise<BuzzState> {
  if ((await Notification.requestPermission()) !== 'granted') return 'blocked';
  const { key } = await call<{ key: string }>('/api/push');
  const reg = await navigator.serviceWorker.register(WORKER, { scope: SCOPE });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key)
    }));
  await call('/api/push', { address: sub.endpoint });
  return 'on';
}

/** Turn the buzz off, at the office and on the phone. */
export async function buzzOff(): Promise<BuzzState> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await call('/api/push', { address: sub.endpoint }, 'DELETE');
    await sub.unsubscribe();
  }
  await reg?.unregister();
  return 'off';
}
