import { DEFAULT_PET_ID } from './pets';
import { AUTO_REVIEW_DEFAULT_TIMEOUT, SUGGESTION_DEFAULT_CONTEXT, TERMINAL_DEFAULT_LINES, type Settings } from './protocol';

/** What a setting is until the user changes it; `theme: null` means "not chosen yet": follow the system. */
export const DEFAULT_SETTINGS: Settings = {
  theme: null, palette: 'default', uiFont: null, codeFont: null, language: 'system', notify: true, sound: true, soundOff: [], renderMermaid: true, suggestions: true,
  suggestionModel: 'session', suggestionModelId: null, suggestionContext: SUGGESTION_DEFAULT_CONTEXT, suggestionFullContext: false,
  workIdeas: true, workIdeasModel: 'session', workIdeasModelId: null,
  autoReview: true, autoReviewModel: 'session', autoReviewModelId: null, autoReviewTimeout: AUTO_REVIEW_DEFAULT_TIMEOUT,
  defaultMode: 'code', sidebarCollapsed: false, worktreeDir: null, pet: true, petSkin: DEFAULT_PET_ID, terminalShell: null,
  autoUpdateCheck: true, ignoredUpdate: null,
  terminalContextLines: TERMINAL_DEFAULT_LINES,
  shellSession: 'session',
  aiSchedule: true, aiCustomize: true, aiSettings: true, aiProject: true,
};
