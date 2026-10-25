import path from 'node:path';

/** An absolute local path; network shares and URLs are refused. */
export function localPath(value: unknown, platform: NodeJS.Platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    /^[/\\]{2}/.test(value) ||
    !paths.isAbsolute(value) ||
    (platform === 'win32' && !/^[A-Za-z]:[/\\]/.test(value))
  ) {
    throw new Error('Choose a local file with an absolute path; network paths and URLs are not supported.');
  }
  return paths.normalize(value);
}
