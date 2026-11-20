import { tr } from '@shared/i18n/runtime';
import { MAX_SESSION_DESCRIPTION, MAX_SESSION_TITLE, type SessionSummary } from '@shared/protocol';

export type PeerSession = Pick<
  SessionSummary,
  'id' | 'kind' | 'title' | 'description' | 'status' | 'branch' | 'updatedAt'
> & {
  project: string;
};

const MAX_HINTS = 4;
const RECENT_MS = 7 * 24 * 60 * 60_000;
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const common =
  /^(?:the|and|for|with|from|this|that|fix|update|please|new|task|session|帮我|这个|一个|修改|修复|更新|新建|会话|任务)$/;
const terms = (text: string) =>
  [...words.segment(text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())]
    .filter(({ isWordLike, segment }) => isWordLike && segment.length > 1 && !common.test(segment))
    .map(({ segment }) => segment);

/** A small shortlist from live metadata only; reading conversations remains an explicit tool call. */
export function formatPeerHints(focus: string, peers: readonly PeerSession[], now = Date.now()): string | undefined {
  const taskTerms = new Set(terms(focus));
  const shortlist = peers
    .filter((p) => p.status === 'running' || now - p.updatedAt < RECENT_MS)
    .map(({ id, title, description, status }) => ({
      id,
      title: title.slice(0, MAX_SESSION_TITLE),
      description: description?.slice(0, MAX_SESSION_DESCRIPTION),
      status,
    }))
    .map((peer) => ({
      peer,
      overlap: new Set(terms(`${peer.title} ${peer.description ?? ''}`).filter((word) => taskTerms.has(word))).size,
    }))
    // Keep working sessions in view even when the task uses different words for the same topic.
    .filter(({ overlap, peer }) => overlap > 0 || peer.status === 'running')
    .sort((a, b) => b.overlap - a.overlap || Number(b.peer.status === 'running') - Number(a.peer.status === 'running'))
    .slice(0, MAX_HINTS);
  if (!shortlist.length) return undefined;
  return tr('ag.sessionPeerHints', { sessions: shortlist.map(({ peer }) => JSON.stringify(peer)).join('\n') });
}
