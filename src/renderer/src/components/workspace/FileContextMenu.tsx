import type { ReactElement } from 'react';
import { CopyIcon, ExternalLinkIcon, FolderOpenIcon, PaperclipIcon } from 'lucide-react';
import type { ApiArgs, OpenTarget, SessionMeta } from '@shared/protocol';
import { copyText } from '@/components/common/Copy';
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { call, isMac } from '@/lib/api';
import { fname } from '@/lib/format';
import { OpenTargetIcon } from '@/components/common/OpenTargetIcon';
import { OPEN_TARGET_INFO, useOpenTargets } from '@/lib/open-targets';
import { fail, sessionDraftKey } from '@/store/actions';
import { drafts, useDrafts } from '@/store/drafts';

interface MenuTarget {
  meta: SessionMeta;
  path: string;
  directory?: boolean;
  /** A deleted file can still be quoted from the diff snapshot. */
  snapshot?: string;
}

export function FileContextMenu({ children, ...target }: MenuTarget & { children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <FileMenuContent {...target} />
    </ContextMenu>
  );
}

/** The menu itself, for a trigger that decides which path it is about (a tree with many rows). */
export function FileMenuContent({ meta, path, directory = false, snapshot }: MenuTarget) {
  const targets = useOpenTargets();
  const key = sessionDraftKey(meta.id);
  const sending = useDrafts((state) => state.drafts[key]?.sending ?? false);
  const separator = meta.cwd.includes('\\') ? '\\' : '/';
  const absolute = meta.cwd.replace(/[\\/]+$/, '') + separator + path.replace(/[\\/]/g, separator);
  const attach = () => drafts.addReference(key, {
    id: crypto.randomUUID(), kind: snapshot === undefined ? 'path' : 'excerpt', path, directory,
    text: snapshot, side: snapshot === undefined ? undefined : 'old',
  });
  const openIn = (target: OpenTarget) => {
    const args: ApiArgs<'sessions:openIn'> = [meta.id, target, path];
    void call('sessions:openIn', ...args).catch(fail);
  };
  return (
      <ContextMenuContent className="min-w-52">
        <ContextMenuGroup>
          <ContextMenuItem disabled={sending} onSelect={attach}><PaperclipIcon />Attach as context</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger><CopyIcon className="mr-2" />Copy</ContextMenuSubTrigger>
            <ContextMenuSubContent><ContextMenuGroup>
              <ContextMenuItem onSelect={() => void copyText(absolute)}>Absolute path</ContextMenuItem>
              <ContextMenuItem onSelect={() => void copyText(path)}>Relative path</ContextMenuItem>
              <ContextMenuItem onSelect={() => void copyText(fname(path))}>{directory ? 'Folder name' : 'Filename'}</ContextMenuItem>
            </ContextMenuGroup></ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger><ExternalLinkIcon className="mr-2" />Open in</ContextMenuSubTrigger>
            <ContextMenuSubContent><ContextMenuGroup>
              {targets.filter((t) => t.id !== 'folder').map((t) => <ContextMenuItem key={t.id} disabled={snapshot !== undefined} onSelect={() => openIn(t.id)}><OpenTargetIcon target={t} />{OPEN_TARGET_INFO[t.id].label}</ContextMenuItem>)}
              <ContextMenuItem disabled={snapshot !== undefined} onSelect={() => void call('sessions:openPath', meta.id, path, false).catch(fail)}>Default app</ContextMenuItem>
            </ContextMenuGroup></ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem disabled={snapshot !== undefined} onSelect={() => void call('sessions:openPath', meta.id, path, true).catch(fail)}><FolderOpenIcon />{isMac ? 'Show in Finder' : 'Show in folder'}</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
  );
}
