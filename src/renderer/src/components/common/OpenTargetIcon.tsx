import { FolderIcon, SquareTerminalIcon } from 'lucide-react';
import type { OpenTargetEntry } from '@shared/protocol';
import { OPEN_TARGET_INFO } from '@/lib/open-targets';

/** The installed app's own icon; a lettered badge when the OS gave us none. */
export function OpenTargetIcon({ target }: { target: OpenTargetEntry }) {
  if (target.icon) return <img src={target.icon} alt="" className="size-5 shrink-0" draggable={false} />;
  if (target.id === 'terminal') return <SquareTerminalIcon className="size-5" />;
  if (target.id === 'folder') return <FolderIcon className="size-5" />;
  const o = OPEN_TARGET_INFO[target.id];
  return <span className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white" style={{ background: o.color }}>{o.badge}</span>;
}
