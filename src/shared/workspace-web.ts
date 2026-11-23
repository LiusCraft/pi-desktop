export const WORKSPACE_WEB_PARTITION = 'pi-workspace-web-';

export function workspaceHttpUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch {
    return null;
  }
}
