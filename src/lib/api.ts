import { auth } from './firebase.ts';
import { handleDemoApiFetch, handleDemoReportDownload } from './demo-api.ts';

let demoModeActive = false;

export function setDemoModeActive(active: boolean) {
  demoModeActive = active;
}

export function isDemoModeActive(): boolean {
  return demoModeActive;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (demoModeActive) {
    return handleDemoApiFetch<T>(path, init);
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sessão não autenticada.');
  }
  const token = await currentUser.getIdToken();

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Erro na requisição (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export async function apiDownloadFile(
  path: string,
  init: RequestInit = {},
  fallbackFilename: string = 'relatorio-nexo-log'
): Promise<string> {
  if (demoModeActive) {
    return handleDemoReportDownload(path, init, fallbackFilename);
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sessão não autenticada.');
  }
  const token = await currentUser.getIdToken();

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Erro ao exportar relatório (${response.status})`);
  }

  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match ? match[1] : fallbackFilename;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return fileName;
}

export function formatKg(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value))} kg`;
}

export function formatTons(kg: number): string {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kg / 1000)} t`;
}
