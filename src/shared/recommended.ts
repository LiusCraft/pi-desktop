// Customize → Recommended: what we suggest installing, grouped by what the user is making.
// A skill is written into the personal skills folder, a plugin is a pi package, a connector is an MCP server.
import type { MessageKey } from './i18n';
import type { ConnectorDraft } from './protocol';

export const RECOMMENDED_GROUPS = ['create', 'roles'] as const;
export type RecommendedGroup = (typeof RECOMMENDED_GROUPS)[number];

interface Base {
  id: string;
  group: RecommendedGroup;
  title: MessageKey;
  desc: MessageKey;
}
export interface RecommendedSkill extends Base {
  kind: 'skill';
  /** Folder name; also how an installed copy is recognised. */
  name: string;
  /** Model-facing: when the skill applies. */
  skillDesc: MessageKey;
  body: MessageKey;
}
export interface RecommendedPlugin extends Base {
  kind: 'plugin';
  source: string;
}
export interface RecommendedConnector extends Base {
  kind: 'connector';
  connector: Omit<ConnectorDraft, 'scope'>;
}
export type Recommended = RecommendedSkill | RecommendedPlugin | RecommendedConnector;

export const RECOMMENDED: readonly Recommended[] = [
  { id: 'slides', group: 'create', kind: 'skill', name: 'make-slides', title: 'rec.slides.title', desc: 'rec.slides.desc', skillDesc: 'rec.slides.skillDesc', body: 'rec.slides.body' },
  { id: 'remotion', group: 'create', kind: 'plugin', source: 'git:github.com/remotion-dev/skills', title: 'rec.remotion.title', desc: 'rec.remotion.desc' },
  { id: 'edge-tts', group: 'create', kind: 'connector', connector: { name: 'edge-tts', transport: 'stdio', command: 'uvx', args: ['--from', 'saitrogen-edge-tts-mcp', 'edge-tts-mcp'] }, title: 'rec.tts.title', desc: 'rec.tts.desc' },
  { id: 'voiceover', group: 'create', kind: 'skill', name: 'voiceover', title: 'rec.voiceover.title', desc: 'rec.voiceover.desc', skillDesc: 'rec.voiceover.skillDesc', body: 'rec.voiceover.body' },
  { id: 'pm', group: 'roles', kind: 'skill', name: 'product-manager', title: 'rec.pm.title', desc: 'rec.pm.desc', skillDesc: 'rec.pm.skillDesc', body: 'rec.pm.body' },
  { id: 'architect', group: 'roles', kind: 'skill', name: 'architect', title: 'rec.arch.title', desc: 'rec.arch.desc', skillDesc: 'rec.arch.skillDesc', body: 'rec.arch.body' },
  { id: 'designer', group: 'roles', kind: 'skill', name: 'ui-designer', title: 'rec.design.title', desc: 'rec.design.desc', skillDesc: 'rec.design.skillDesc', body: 'rec.design.body' },
];
