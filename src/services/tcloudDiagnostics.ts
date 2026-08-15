export interface TCloudClientError {
  id: string;
  message: string;
  source?: string;
  stack?: string;
  createdAt: number;
}

const KEY = 'tcloud:client-errors-v1';
const LIMIT = 100;
let installed = false;

export function listClientErrors(): TCloudClientError[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as TCloudClientError[]; }
  catch { return []; }
}

export function clearClientErrors() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('tcloud-errors-changed'));
}

export function logClientError(message: string, source?: string, stack?: string) {
  const rows = listClientErrors();
  rows.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, message, source, stack, createdAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, LIMIT)));
  window.dispatchEvent(new Event('tcloud-errors-changed'));
}

export function installClientDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => logClientError(event.message, event.filename, event.error?.stack));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logClientError(reason instanceof Error ? reason.message : String(reason), 'Promise', reason instanceof Error ? reason.stack : undefined);
  });
}
