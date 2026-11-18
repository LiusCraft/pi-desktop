// The first message of a session started from a suggested task. The model gets the prompt as an
// ordinary user message in this wrapper; the transcript shows it as a task card.

export const TASK_NOTIFICATION_TYPE = 'pi-desktop-task-notification';

export function taskNotificationText(content: string): string {
  // Keep the model's envelope out of the transcript, not the report inside it.
  return /^<task-notification [^>]*>\n([\s\S]*)\n<\/task-notification>$/.exec(content)?.[1] ?? content;
}

const attr = (value: string) =>
  value
    .replace(/["\r\n<>]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

export interface TaskMessage {
  title: string;
  prompt: string;
}

export const encodeTaskMessage = (title: string, prompt: string) =>
  `<pi-task title="${attr(title)}">\n${prompt}\n</pi-task>`;

export function decodeTaskMessage(wire: string): TaskMessage | null {
  const m = /^<pi-task title="([^"]*)">\n([\s\S]*)\n<\/pi-task>$/.exec(wire.trim());
  return m ? { title: m[1], prompt: m[2] } : null;
}

export const isTaskMessage = (wire: string) => wire.startsWith('<pi-task ');
