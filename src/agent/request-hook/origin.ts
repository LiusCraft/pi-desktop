// Which part of the app a model request belongs to, for the usage view's "Agent" split. Sessions are known by their
// id (the hub tags subagents and resolves the main ones); the side calls that borrow a session's id (naming,
// predictions, side chat) say what they are for the length of the call.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestOrigin } from '@shared/request-log';

export interface Origin {
  origin: RequestOrigin;
  /** The subagent's name, for `subagent`. */
  subagent?: string;
  /** The session the request is for, when the id it was made with is not the app's own. */
  session?: string;
}

const scope = new AsyncLocalStorage<Origin>();

/** Runs `fn`; model requests it starts belong to `origin`. */
export const withOrigin = <T>(origin: Origin, fn: () => T): T => scope.run(origin, fn);

export const currentOrigin = (): Origin | undefined => scope.getStore();
