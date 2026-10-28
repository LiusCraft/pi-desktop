import type { ReactElement } from 'react';
import { CopyIcon, ExternalLinkIcon, FolderOpenIcon, PackageIcon, PaperclipIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiArgs, OpenTarget, SessionMeta } from '@shared/protocol';
import { copyText } from '@/components/common/Copy';
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { call, isMac } from '@/lib/api';
import { fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { OpenTargetIcon } from '@/components/common/OpenTargetIcon';
import { OPEN_TARGET_INFO, useOpenTargets } from '@/lib/open-targets';
import { fail, sessionDraftKey } from '@/store/actions';
import { drafts, useDrafts } from '@/store/drafts';

const HTML_FILE = /\.html?$/i;

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
  const t = useT();
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
  const makeArtifact = () => {
    call('artifacts:fromFile', meta.id, path).then(() => toast.success(t('fileMenu.artifactSaved')), fail);
  };
  return (
      <ContextMenuContent className="min-w-52">
        <ContextMenuGroup>
          <ContextMenuItem disabled={sending} onSelect={attach}><PaperclipIcon />{t('fileMenu.attach')}</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger><CopyIcon className="mr-2" />{t('fileMenu.copy')}</ContextMenuSubTrigger>
            <ContextMenuSubContent><ContextMenuGroup>
              <ContextMenuItem onSelect={() => void copyText(absolute)}>{t('fileMenu.absolute')}</ContextMenuItem>
              <ContextMenuItem onSelect={() => void copyText(path)}>{t('fileMenu.relative')}</ContextMenuItem>
              <ContextMenuItem onSelect={() => void copyText(fname(path))}>{t(directory ? 'fileMenu.folderName' : 'fileMenu.fileName')}</ContextMenuItem>
            </ContextMenuGroup></ContextMenuSubContent>
          </ContextMenuSub>
          {HTML_FILE.test(path) && !directory && snapshot === undefined && (
            <ContextMenuItem onSelect={makeArtifact}><PackageIcon />{t('fileMenu.makeArtifact')}</ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger><ExternalLinkIcon className="mr-2" />{t('fileMenu.openIn')}</ContextMenuSubTrigger>
            <ContextMenuSubContent><ContextMenuGroup>
              {targets.filter((o) => o.id !== 'folder').map((o) => <ContextMenuItem key={o.id} disabled={snapshot !== undefined} onSelect={() => openIn(o.id)}><OpenTargetIcon target={o} />{OPEN_TARGET_INFO[o.id].label}</ContextMenuItem>)}
              <ContextMenuItem disabled={snapshot !== undefined} onSelect={() => void call('sessions:openPath', meta.id, path, false).catch(fail)}>{t('fileMenu.defaultApp')}</ContextMenuItem>
            </ContextMenuGroup></ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem disabled={snapshot !== undefined} onSelect={() => void call('sessions:openPath', meta.id, path, true).catch(fail)}><FolderOpenIcon />{t(isMac ? 'fileMenu.revealMac' : 'fileMenu.revealOther')}</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
  );
}
