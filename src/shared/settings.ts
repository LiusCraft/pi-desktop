import { DEFAULT_PET_ID } from './pets';
import { SUGGESTION_DEFAULT_CONTEXT, TERMINAL_DEFAULT_LINES, type Settings } from './protocol';

/** What a setting is until the user changes it; `theme: null` means "not chosen yet": follow the system. */
export const DEFAULT_SETTINGS: Settings = {
  theme: null, language: 'system', notify: true, renderMermaid: true, suggestions: true,
  suggestionModel: 'session', suggestionModelId: null, suggestionContext: SUGGESTION_DEFAULT_CONTEXT, suggestionFullContext: false,
  workIdeas: true, workIdeasModel: 'session', workIdeasModelId: null,
  defaultMode: 'code', sidebarCollapsed: false, worktreeDir: null, pet: true, petSkin: DEFAULT_PET_ID, terminalShell: null,
  terminalContextLines: TERMINAL_DEFAULT_LINES,
  shellSession: 'session',
  aiSchedule: true, aiCustomize: true, aiSettings: true, aiProject: true,
};
