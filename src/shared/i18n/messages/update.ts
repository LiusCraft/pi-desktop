import { defineMessages } from '../define';

export const update = defineMessages({
  'update.title': { en: 'Updates', zh: '更新' },
  'update.auto': { en: 'Check automatically', zh: '自动检查更新' },
  'update.auto.hint': { en: 'At startup and every few hours', zh: '启动时及每隔数小时' },
  'update.found': { en: 'New version v{version}', zh: '发现新版本 v{version}' },
  'update.ignore': { en: 'Ignore', zh: '忽略' },
  'update.check': { en: 'Check for updates', zh: '检查更新' },
  'update.checking': { en: 'Checking…', zh: '检查中…' },
  'update.upToDate': { en: 'Up to date', zh: '已是最新版本' },
  'update.available': { en: 'v{version} available', zh: '有新版本 v{version}' },
  'update.noInstaller': { en: 'No installer for this system', zh: '该系统暂无安装包' },
  'update.install': { en: 'Update now', zh: '立即更新' },
  'update.downloading': { en: 'Downloading {percent}%', zh: '下载中 {percent}%' },
  'update.launching': { en: 'Starting installer…', zh: '正在启动安装程序…' },
  'update.installTip': {
    en: 'Windows: the installer runs and the app quits. macOS: the dmg opens; drag the app into Applications.',
    zh: 'Windows：运行安装程序并退出应用。macOS：打开 dmg，将应用拖入“应用程序”。',
  },
  'update.changes': { en: 'Changes', zh: '更新内容' },
  'update.changesSub': { en: 'Release notes of recent versions.', zh: '近期版本的更新说明。' },
  'update.current': { en: 'Current', zh: '当前' },
  'update.noNotes': { en: 'No notes', zh: '无说明' },
  'update.viewOnGithub': { en: 'View on GitHub', zh: '在 GitHub 查看' },
  'update.noReleases': { en: 'No releases yet', zh: '暂无发布' },
});
