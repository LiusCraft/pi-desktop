// Shared wire format for prompts and persisted user messages. No DOM or Node APIs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.PiAttachments = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LIMITS = Object.freeze({
    count: 10,
    fileBytes: 20 * 1024 * 1024,
    sourceBytes: 50 * 1024 * 1024,
    imageBytes: 4.5 * 1024 * 1024,
    totalImageBytes: 20 * 1024 * 1024,
    manifestBytes: 65536,
    dimension: 2000,
  });
  const START = '[pi-desktop:attachments:v1]\n';
  const END = '\n[/pi-desktop:attachments]';
  const RASTER = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const MIME = /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/;
  const OMITTED = new Set([
    '[Image omitted: could not be converted to a supported inline image format.]',
    '[Image omitted: could not be resized below the inline image size limit.]',
  ]);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const boundedString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
  const rasterMime = (value) => typeof value === 'string' && own(RASTER, value);
  const absolutePath = (value) => boundedString(value, 32768) && (
    value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
  );

  function utf8Bytes(value) {
    let bytes = 0;
    for (const char of value) {
      const code = char.codePointAt(0);
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  // Check canonical raw base64 without decoding/allocating another image copy.
  // Avoid a repeated-group regex: multi-megabyte images can exhaust its stack.
  function base64Size(data) {
    if (typeof data !== 'string' || !data.length || data.length > LIMITS.imageBytes || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) return -1;
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    const firstPadding = data.indexOf('=');
    if (firstPadding !== -1 && firstPadding !== data.length - padding) return -1;
    if (padding === 2 && (BASE64.indexOf(data[data.length - 3]) & 15)) return -1;
    if (padding === 1 && (BASE64.indexOf(data[data.length - 2]) & 3)) return -1;
    return data.length / 4 * 3 - padding;
  }

  function imageSource(attachment) {
    if (!record(attachment) || attachment.kind !== 'image' || !rasterMime(attachment.mimeType) || base64Size(attachment.data) < 0) return '';
    return `data:${attachment.mimeType};base64,${attachment.data}`;
  }

  function assertKeys(value, required, optional = []) {
    if (!record(value) || required.some((key) => !own(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
      throw new Error('Invalid attachment schema.');
    }
  }

  function validateItems(items, manifest) {
    if (!Array.isArray(items)) throw new Error('Attachments must be an array.');
    if (items.length > LIMITS.count) throw new Error(`At most ${LIMITS.count} attachments are allowed.`);
    let sourceBytes = 0, imageBytes = 0, imageIndex = 0;
    const ids = new Set();
    for (const item of items) {
      const extra = item?.kind === 'file' ? 'path' : manifest ? 'imageIndex' : 'data';
      assertKeys(item, ['id', 'kind', 'name', 'mimeType', 'size', extra]);
      if (!boundedString(item.id, 256) || ids.has(item.id)) throw new Error('Attachment IDs must be unique nonempty strings.');
      ids.add(item.id);
      if (!boundedString(item.name, 4096)) throw new Error('Invalid attachment name.');
      if (!boundedString(item.mimeType, 128) || !MIME.test(item.mimeType)) throw new Error('Invalid attachment MIME type.');
      if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > LIMITS.fileBytes) throw new Error('Each attachment source must be at most 20 MiB.');
      sourceBytes += item.size;
      if (sourceBytes > LIMITS.sourceBytes) throw new Error('Attachment sources must total at most 50 MiB.');
      if (item.kind === 'file') {
        if (!absolutePath(item.path)) throw new Error('File attachments require an absolute path.');
      } else if (item.kind === 'image') {
        if (!rasterMime(item.mimeType)) throw new Error('Unsupported inline image MIME type.');
        if (manifest) {
          if (item.imageIndex !== imageIndex) throw new Error('Invalid attachment image index.');
          imageIndex++;
        } else {
          if (typeof item.data !== 'string' || item.data.length > LIMITS.imageBytes) throw new Error('Each inline image base64 payload must be at most 4.5 MiB.');
          if (base64Size(item.data) < 0) throw new Error('Invalid inline image base64 payload.');
          imageBytes += item.data.length;
          if (imageBytes > LIMITS.totalImageBytes) throw new Error('Inline image base64 payloads must total at most 20 MiB.');
        }
      } else {
        throw new Error('Invalid attachment kind.');
      }
    }
    return items;
  }

  function validateAttachments(attachments) {
    return validateItems(attachments, false);
  }

  function buildMessage({ text = '', attachments = [], clientId } = {}) {
    if (typeof text !== 'string') throw new Error('Prompt text must be a string.');
    validateAttachments(attachments);
    if (!attachments.length) return { message: text, images: [] };
    if (clientId !== undefined && !boundedString(clientId, 256)) throw new Error('Invalid attachment client ID.');
    const images = [];
    const items = attachments.map((attachment) => {
      const { id, kind, name, mimeType, size } = attachment;
      const item = { id, kind, name, mimeType, size };
      if (kind === 'file') item.path = attachment.path;
      else {
        item.imageIndex = images.length;
        images.push({ type: 'image', data: attachment.data, mimeType });
      }
      return item;
    });
    const manifest = { v: 1, textLength: text.length, items };
    if (clientId !== undefined) manifest.clientId = clientId;
    // JSON must stay on one physical line even for unusual Unix filenames.
    const json = JSON.stringify(manifest).replace(new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g'), (char) => `\\u${char.charCodeAt(0).toString(16)}`);
    if (utf8Bytes(json) > LIMITS.manifestBytes) throw new Error('Attachment manifest must be at most 64 KiB.');
    return { message: `${text}\n\n${START}${json}${END}`, images };
  }

  function parseManifest(text) {
    if (!text.endsWith(END)) return null;
    const jsonEnd = text.length - END.length;
    const jsonStart = text.lastIndexOf('\n', jsonEnd - 1) + 1;
    const markerStart = jsonStart - START.length;
    if (markerStart < 2 || text.slice(markerStart, jsonStart) !== START || text.slice(markerStart - 2, markerStart) !== '\n\n') return null;
    const json = text.slice(jsonStart, jsonEnd);
    if (json.length > LIMITS.manifestBytes || /[\r\n]/.test(json) || json.includes(String.fromCharCode(0x2028)) || json.includes(String.fromCharCode(0x2029)) || utf8Bytes(json) > LIMITS.manifestBytes) return null;
    try {
      const manifest = JSON.parse(json);
      assertKeys(manifest, ['v', 'textLength', 'items'], ['clientId']);
      if (manifest.v !== 1 || !Number.isSafeInteger(manifest.textLength) || manifest.textLength < 0 || manifest.textLength !== markerStart - 2) return null;
      if (own(manifest, 'clientId') && !boundedString(manifest.clientId, 256)) return null;
      validateItems(manifest.items, true);
      if (!manifest.items.length) return null;
      return { text: text.slice(0, markerStart - 2), manifest, hints: [] };
    } catch {
      return null;
    }
  }

  function hintKind(line) {
    if (OMITTED.has(line)) return 'omitted';
    const converted = /^\[Image converted from (image\/[a-z0-9][a-z0-9.+-]*) to (image\/(?:png|jpeg|gif|webp))\.\]$/.exec(line);
    if (converted && converted[1] !== converted[2]) return 'converted';
    const dimension = /^\[Image: original ([1-9]\d*)x([1-9]\d*), displayed at ([1-9]\d*)x([1-9]\d*)\. Multiply coordinates by (\d+\.\d{2}) to map to original image\.\]$/.exec(line);
    if (dimension) {
      const [width, height, displayedWidth, displayedHeight] = dimension.slice(1, 5).map(Number);
      if ([width, height, displayedWidth, displayedHeight].every(Number.isSafeInteger) && (width / displayedWidth).toFixed(2) === dimension[5]) return 'dimension';
    }
    return '';
  }

  function manifestWithHints(text) {
    const direct = parseManifest(text);
    if (direct) return direct;
    // The SDK appends exactly two newlines, then known hints joined by LF.
    // Only remove them if the remaining suffix is a valid, length-matched
    // manifest. Ordinary text containing these phrases is never normalized.
    let end = text.length;
    const hints = [], kinds = [];
    while (hints.length < LIMITS.count * 2) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline < 0) break;
      const line = text.slice(newline + 1, end);
      const kind = hintKind(line);
      if (!kind) break;
      hints.unshift(line);
      kinds.unshift(kind);
      end = newline;
    }
    if (!hints.length || text[end - 1] !== '\n') return null;
    const parsed = parseManifest(text.slice(0, end - 1));
    if (!parsed) return null;
    const imageCount = parsed.manifest.items.filter((item) => item.kind === 'image').length;
    const omitted = kinds.filter((kind) => kind === 'omitted').length;
    if (!imageCount || omitted > imageCount || ['converted', 'dimension'].some((kind) => kinds.filter((value) => value === kind).length > imageCount - omitted)) return null;
    parsed.hints = hints;
    return parsed;
  }

  function nativeImage(block) {
    // Pi's persisted blocks are flat. Also accept standard base64 source blocks
    // when importing native history, but never fetch image URLs or file IDs.
    const source = record(block.source) && block.source.type === 'base64' ? block.source : block;
    const mimeType = source === block ? block.mimeType : source.media_type;
    const data = source.data;
    return { mimeType, data, valid: rasterMime(mimeType) && base64Size(data) >= 0 };
  }

  function genericImages(images, usedIds = new Set()) {
    return images.map((image, index) => {
      let id = `native-image-${index + 1}`;
      while (usedIds.has(id)) id += '-native';
      usedIds.add(id);
      const mimeType = boundedString(image.mimeType, 128) && MIME.test(image.mimeType) ? image.mimeType : 'application/octet-stream';
      const extension = rasterMime(mimeType) ? `.${RASTER[mimeType]}` : '';
      const attachment = { id, kind: 'image', name: `Image ${index + 1}${extension}`, mimeType, size: image.valid ? base64Size(image.data) : 0 };
      if (image.valid) attachment.data = image.data;
      else attachment.missing = true;
      return attachment;
    });
  }

  function decodeUserContent(content) {
    const blocks = Array.isArray(content) ? content : [];
    const text = typeof content === 'string' ? content : blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
    const images = blocks.filter((block) => block?.type === 'image').map(nativeImage);
    const parsed = manifestWithHints(text);
    const imageCount = parsed?.manifest.items.filter((item) => item.kind === 'image').length;
    if (!parsed || images.length > imageCount) {
      const attachments = genericImages(images);
      const result = { text, attachments };
      if (attachments.some((attachment) => attachment.missing)) result.notice = 'Some attached images are unavailable in this message.';
      return result;
    }

    // When the SDK omits one image it compacts the image array without recording
    // which input failed. Do not assign a surviving thumbnail to a wrong name.
    const ambiguous = images.length > 0 && images.length < imageCount;
    const attachments = parsed.manifest.items.map((item) => {
      const attachment = { id: item.id, kind: item.kind, name: item.name, mimeType: item.mimeType, size: item.size };
      if (item.kind === 'file') attachment.path = item.path;
      else {
        const image = ambiguous ? null : images[item.imageIndex];
        if (image?.valid) {
          attachment.mimeType = image.mimeType;
          attachment.data = image.data;
        } else attachment.missing = true;
      }
      return attachment;
    });
    if (ambiguous) attachments.push(...genericImages(images, new Set(attachments.map((attachment) => attachment.id))));
    const result = { text: parsed.text, attachments };
    if (own(parsed.manifest, 'clientId')) result.clientId = parsed.manifest.clientId;
    const notices = [...parsed.hints];
    if (ambiguous) notices.push('Some image data is missing; surviving images could not be reliably matched to attachment names.');
    else if (attachments.some((attachment) => attachment.missing)) notices.push('Some attached images are unavailable in this message.');
    if (notices.length) result.notice = notices.join('\n');
    return result;
  }

  return { LIMITS, buildMessage, decodeUserContent, imageSource, validateAttachments };
});
