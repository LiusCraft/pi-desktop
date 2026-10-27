// Where each conversation was scrolled to.
//
// Switching sessions remounts the transcript, so without this every old conversation
// would jump to the bottom (or to the top) instead of the place the user left it at.

export interface ScrollSpot {
  /** Offset inside the transcript, in pixels. */
  top: number;
  /** Whether the user was following the newest message. */
  stick: boolean;
}

const spots = new Map<string, ScrollSpot>();

export const savedScroll = (id: string) => spots.get(id) ?? null;
export const rememberScroll = (id: string, spot: ScrollSpot) => void spots.set(id, spot);
/** The session moved on while it was closed: open it at the newest message instead. */
export const forgetScroll = (id: string) => void spots.delete(id);
