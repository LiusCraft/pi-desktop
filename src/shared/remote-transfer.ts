// Transfer replies cross an HTTP/JSON boundary. Decode them before attachment metadata reaches a
// prompt or artifact files reach the local preview cache; a caller's type argument is not validation.
import { validateAttachments } from './attachments';
import type { AttachmentImportResult } from './protocol';
import type { RemoteArtifactFile, RemoteArtifactSite, RemoteTransferMethod, RemoteTransferResult } from './remote';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseUploadResult(value: unknown): AttachmentImportResult {
  if (!record(value) || !Array.isArray(value.errors)) throw new Error('Invalid remote upload result.');
  const errors = value.errors.map((error: unknown) => {
    if (!record(error) || typeof error.name !== 'string' || typeof error.message !== 'string')
      throw new Error('Invalid remote upload error.');
    return { name: error.name, message: error.message };
  });
  return { attachments: validateAttachments(value.attachments), errors };
}

function parseArtifactSite(value: unknown): RemoteArtifactSite | null {
  if (value === null) return null;
  if (!record(value) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1)
    throw new Error('Invalid remote artifact site.');
  if (!('files' in value)) return { version: value.version };
  if (!Array.isArray(value.files)) throw new Error('Invalid remote artifact files.');
  const files = value.files.map((file: unknown): RemoteArtifactFile => {
    if (!record(file) || typeof file.rel !== 'string' || !file.rel || typeof file.data !== 'string')
      throw new Error('Invalid remote artifact file.');
    return { rel: file.rel, data: file.data };
  });
  return { version: value.version, files };
}

export function parseRemoteTransferResult(method: RemoteTransferMethod, value: unknown): RemoteTransferResult {
  switch (method) {
    case 'attachments:upload':
      return parseUploadResult(value);
    case 'artifacts:site':
      return parseArtifactSite(value);
  }
}
