import type { Entry } from '../define';
import { agent } from './agent';
import { actions } from './actions';
import { pet } from './pet';
import { widgets } from './widgets';
import { git } from './git';
import { tools } from './tools';
import { workspace } from './workspace';
import { thread } from './thread';
import { pages } from './pages';
import { scheduled } from './scheduled';
import { customize } from './customize';
import { remote } from './remote';
import { models } from './models';
import { common } from './common';
import { composer } from './composer';
import { main } from './main';
import { settings } from './settings';
import { sidebar } from './sidebar';
import { web } from './web';
import { update } from './update';
import { privacy } from './privacy';

/** Every message of the app, by dotted key; each area lives in its own file next to this one. */
export const MESSAGES = { ...agent, ...actions, ...pet, ...widgets, ...git, ...tools, ...workspace, ...thread, ...pages, ...scheduled, ...customize, ...remote, ...models, ...common, ...composer, ...main, ...settings, ...sidebar, ...web, ...update, ...privacy } satisfies Record<string, Entry>;
export type MessageKey = keyof typeof MESSAGES;
