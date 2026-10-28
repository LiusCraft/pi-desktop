import { defineMessages } from '../define';

export const customize = defineMessages({
  'customize.title': { en: 'Customize', zh: '自定义' },
  'customize.loading': { en: 'Loading…', zh: '加载中…' },
  'customize.tab.skills': { en: 'Skills', zh: '技能' },
  'customize.tab.connectors': { en: 'Connectors', zh: '连接器' },
  'customize.tab.plugins': { en: 'Plugins', zh: '插件' },
  'customize.tab.prompts': { en: 'Commands', zh: '命令' },
  'customize.tab.agents': { en: 'Subagents', zh: '子代理' },
  'customize.project': { en: 'Project: ', zh: '项目：' },
  'customize.workOnlyPersonal': { en: 'Work only uses personal settings', zh: 'Work 只使用个人配置' },
  'customize.noProject': { en: 'No project selected; only personal settings are shown', zh: '没有选择项目，只显示个人配置' },
  'customize.noDescription': { en: '(no description)', zh: '（没有描述）' },
  'customize.scope.package': { en: 'Plugin', zh: '插件' },
  'customize.scope.project': { en: 'Project', zh: '项目' },
  'customize.scope.user': { en: 'Personal', zh: '个人' },

  'prompts.sub': { en: 'Type /name to expand a preset prompt', zh: '输入 /名称 展开预设提示' },
  'prompts.tip': { en: 'Add a .md file to the prompts folder to create one.', zh: '把 .md 文件放进 prompts 文件夹即可添加。' },
  'prompts.new': { en: 'New command', zh: '新建命令' },
  'prompts.new.sub': { en: 'Type /name in the input box to insert this text', zh: '在输入框输入 /名称 即插入这段文字' },
  'prompts.new.tip': { en: 'Unlike a skill, a command is only used when you type it; the model never picks it.', zh: '与技能不同，命令只在你输入时使用，模型不会自己选用。' },
  'prompts.edit': { en: 'Edit /{name}', zh: '编辑 /{name}' },
  'prompts.save': { en: 'Save', zh: '保存' },
  'prompts.saved': { en: 'Saved; new sessions will use it', zh: '已保存，新会话生效' },
  'prompts.delete': { en: 'Delete', zh: '删除' },
  'prompts.deleteTitle': { en: 'Delete /{name}?', zh: '删除 /{name}？' },
  'prompts.deleteBody': { en: 'The file is removed.', zh: '会删除对应的文件。' },
  'prompts.back': { en: 'Back to commands', zh: '返回命令列表' },
  'prompts.created': { en: 'Created; new sessions will use it', zh: '已创建，新会话生效' },
  'prompts.name.hint': { en: 'Letters, digits, - and _', zh: '字母、数字、- 和 _' },
  'prompts.content': { en: 'Content', zh: '内容' },
  'prompts.empty': { en: 'No prompt templates. Add a Markdown file to {dir}.', zh: '还没有提示模板。把 Markdown 文件放进 {dir}。' },

  'skills.scope.user': { en: 'Personal skills', zh: '个人技能' },
  'skills.scope.project': { en: 'Project skills', zh: '项目技能' },
  'skills.scope.package': { en: 'From plugins', zh: '来自插件' },
  'skills.manualOnly': { en: 'Manual only', zh: '仅手动' },
  'skills.manualOnlyHint': { en: 'Can only be invoked with /skill:name; the model never picks it by itself', zh: '只能用 /skill:名称 手动调用，模型不会自己选它' },
  'skills.enable': { en: 'Enable {name}', zh: '启用 {name}' },
  'skills.disable': { en: 'Disable {name}', zh: '停用 {name}' },
  'skills.cantRead': { en: 'Cannot read: {error}', zh: '无法读取：{error}' },
  'skills.back': { en: 'Back to skills', zh: '返回技能列表' },
  'skills.showFile': { en: 'Show file', zh: '显示文件' },
  'skills.created': { en: 'Created; new sessions will use it', zh: '已创建，新会话生效' },
  'skills.new': { en: 'New skill', zh: '新建技能' },
  'skills.new.sub': { en: 'A manual written for the model', zh: '写给模型的说明书' },
  'skills.new.tip': { en: 'The description decides when it is used; the body tells the model how.', zh: '描述决定何时用到，正文告诉模型怎么做。' },
  'skills.saveTo': { en: 'Save to', zh: '保存位置' },
  'skills.allProjects': { en: 'Available in every project.', zh: '所有项目都能用。' },
  'skills.onlyIn': { en: 'Only active in {name}.', zh: '只在 {name} 里生效。' },
  'skills.thisProject': { en: 'the current project', zh: '当前项目' },
  'skills.personal': { en: 'Personal', zh: '个人' },
  'skills.projectOpt': { en: 'Project', zh: '项目' },
  'skills.store': { en: 'Stored in', zh: '存放在' },
  'skills.homeAgents': { en: 'Saved in {home}/.agents/skills; other tools read it too', zh: '存于 {home}/.agents/skills，其他工具也会读取' },
  'skills.homePiUser': { en: "pi's skills folder", zh: 'pi 的 skills 文件夹' },
  'skills.homePiProject': { en: "the project's .pi/skills", zh: '项目的 .pi/skills' },
  'skills.homePi': { en: 'pi only, saved in {where}', zh: '仅 pi 使用，存于 {where}' },
  'skills.homeShared': { en: '.agents (shared)', zh: '.agents（通用）' },
  'skills.name': { en: 'Name', zh: '名称' },
  'skills.name.hint': { en: 'Letters, digits, - and _', zh: '字母、数字、- 和 _' },
  'skills.description': { en: 'Description', zh: '描述' },
  'skills.description.hint': { en: 'When to use it; shown to the model', zh: '何时使用；展示给模型' },
  'skills.content': { en: 'Content (Markdown)', zh: '内容（Markdown）' },
  'skills.create': { en: 'Create', zh: '创建' },
  'skills.cancel': { en: 'Cancel', zh: '取消' },
  'skills.imported': { en: 'Imported; new sessions will use them', zh: '已引入，新会话生效' },
  'skills.sub': { en: 'Teach the model to work your way', zh: '教模型按你的方式做事' },
  'skills.tip': { en: 'Disabled skills stay on disk and are just not loaded.', zh: '停用的技能留在磁盘上，只是不再加载。' },
  'skills.openFolder': { en: 'Open folder', zh: '打开文件夹' },
  'skills.piSkills': { en: "pi's skills", zh: 'pi 的 skills' },
  'skills.sharedSkills': { en: '~/.agents/skills (shared)', zh: '~/.agents/skills（通用）' },
  'skills.claudeFound': { en: 'Found {n} Claude Code skills. Import?', zh: '发现 {n} 个 Claude Code 技能，引入吗？' },
  'skills.claudeHint': { en: 'Read from {dir}, not copied', zh: '直接读取 {dir}，不复制' },
  'skills.import': { en: 'Import', zh: '引入' },
  'skills.dismiss': { en: 'No thanks', zh: '不用了' },
  'skills.empty': { en: 'No skills yet. Create one, or install a plugin.', zh: '还没有技能。新建一个，或安装插件。' },
  'skills.nSkills': { en: '{n} skills', zh: '{n} 个技能' },
  'skills.untrusted': { en: 'Project not trusted yet; its skills and connectors are not loaded', zh: '项目尚未信任，其技能和连接器不会加载' },

  'connectors.saved': { en: 'Saved; new sessions will connect', zh: '已保存，新会话生效' },
  'connectors.back': { en: 'Back to connectors', zh: '返回连接器列表' },
  'connectors.edit': { en: 'Edit {name}', zh: '编辑 {name}' },
  'connectors.add': { en: 'Add connector', zh: '添加连接器' },
  'connectors.form.sub': { en: 'An MCP server that gives the model more tools', zh: '给模型更多工具的 MCP 服务器' },
  'connectors.type': { en: 'Type', zh: '类型' },
  'connectors.local': { en: 'Local command', zh: '本地命令' },
  'connectors.remote': { en: 'Remote URL', zh: '远程地址' },
  'connectors.name.hint': { en: 'Letters, digits, - and _', zh: '字母、数字、- 和 _' },
  'connectors.url': { en: 'URL', zh: '地址' },
  'connectors.url.hint': { en: 'Streamable HTTP MCP URL, usually ending in /mcp', zh: 'streamable HTTP 的 MCP 地址，通常以 /mcp 结尾' },
  'connectors.headers': { en: 'Headers', zh: '请求头' },
  'connectors.headers.hint': { en: 'One per line: Name: value', zh: '每行一个：Name: value' },
  'connectors.command': { en: 'Command', zh: '命令' },
  'connectors.args': { en: 'Arguments', zh: '参数' },
  'connectors.args.hint': { en: 'Space-separated; quote ones with spaces', zh: '空格分隔，带空格的加引号' },
  'connectors.env': { en: 'Environment variables', zh: '环境变量' },
  'connectors.env.hint': { en: 'One per line: KEY=value', zh: '每行一个：KEY=value' },
  'connectors.descOptional': { en: 'Description (optional)', zh: '说明（可选）' },
  'connectors.exposure': { en: 'Tool access', zh: '工具调用方式' },
  'connectors.exposure.hint': { en: 'How the model reaches its tools', zh: '模型怎样使用它的工具' },
  'connectors.exposure.codemode': { en: 'Script', zh: '脚本' },
  'connectors.exposure.deferred': { en: 'On demand', zh: '按需加载' },
  'connectors.exposure.direct': { en: 'Direct', zh: '直接' },
  'connectors.exposure.hidden': { en: 'Hidden', zh: '隐藏' },
  'connectors.exposure.tip': {
    en: 'Script: tools are only callable from codemode scripts (turns codemode on). On demand: loaded through tool_search, then called directly. Direct: all declared up front, best for a few tools. Hidden: not given to the model.',
    zh: '脚本：工具只能在 codemode 脚本里调用（会自动启用 codemode）。按需加载：先用 tool_search 加载，再直接调用。直接：全部预先声明，适合工具少时。隐藏：不提供给模型。',
  },
  'connectors.saveTo': { en: 'Save to', zh: '保存位置' },
  'connectors.saveUser': { en: 'Every project; written to mcp.json', zh: '所有项目；写入 mcp.json' },
  'connectors.saveProject': { en: '{name} only; written to .pi/mcp.json', zh: '仅 {name}；写入 .pi/mcp.json' },
  'connectors.save': { en: 'Save', zh: '保存' },
  'connectors.cancel': { en: 'Cancel', zh: '取消' },
  'connectors.remoteServer': { en: 'Remote MCP server', zh: '远程 MCP 服务器' },
  'connectors.localServer': { en: 'Local MCP server', zh: '本地 MCP 服务器' },
  'connectors.enable': { en: 'Enable', zh: '启用' },
  'connectors.disable': { en: 'Disable', zh: '停用' },
  'connectors.editBtn': { en: 'Edit', zh: '编辑' },
  'connectors.deleteBtn': { en: 'Delete', zh: '删除' },
  'connectors.tools': { en: 'Tools', zh: '工具' },
  'connectors.noTools': { en: 'No tools recorded yet; they appear after the first connection.', zh: '暂无工具；首次连接成功后列出。' },
  'connectors.confirmTitle': { en: 'Delete {name}?', zh: '删除 {name}？' },
  'connectors.confirmBody': { en: 'Only removes it from the config; the server is untouched.', zh: '只从配置移除，不影响服务器本身。' },
  'connectors.title': { en: 'Connectors', zh: '连接器' },
  'connectors.sub': { en: 'Connect outside tools and data (MCP)', zh: '接入外部工具和数据（MCP）' },
  'connectors.tip': { en: 'Changes apply to new sessions only.', zh: '改动只对新会话生效。' },
  'connectors.nTools': { en: '{n} tools', zh: '{n} 个工具' },
  'connectors.empty': { en: 'No connectors yet.', zh: '还没有连接器。' },

  'agents.saved': { en: 'Saved; new sessions will use it', zh: '已保存，新会话生效' },
  'agents.edit': { en: 'Edit {name}', zh: '编辑 {name}' },
  'agents.new': { en: 'New subagent', zh: '新建子代理' },
  'agents.form.sub': { en: 'The description decides when it is picked, the prompt how it works', zh: '描述决定何时选用，系统提示决定怎么做' },
  'agents.form.tip': { en: 'Subagents are always read-only and never modify files.', zh: '子代理始终只读，不会修改文件。' },
  'agents.name.hint': { en: 'Letters, digits, - and _', zh: '字母、数字、- 和 _' },
  'agents.description.hint': { en: 'What it is good at; shown to the model', zh: '擅长什么；展示给模型' },
  'agents.model': { en: 'Model', zh: '模型' },
  'agents.followMain': { en: "Follow the main session's model", zh: '跟随主会话的模型' },
  'agents.modelLabel': { en: 'Model used by the subagent', zh: '子代理使用的模型' },
  'agents.tools': { en: 'Tool allowlist', zh: '工具白名单' },
  'agents.tools.hint': { en: 'Name or pattern (e.g. mcp__*), then Enter', zh: '名称或模式（如 mcp__*），回车添加' },
  'agents.tools.tip': { en: 'Empty uses the default read-only tools plus MCP tools; otherwise only the tools listed here are enabled. You can also pick from the list.', zh: '留空则使用默认的只读工具并保留 MCP 工具；填写后只启用这里列出的工具。也可以从下拉里选。' },
  'agents.toolsPh': { en: 'Empty = default', zh: '留空 = 默认' },
  'agents.prompt': { en: 'System prompt', zh: '系统提示' },
  'agents.saveCustom': { en: 'Save as custom version', zh: '保存为自定义版本' },
  'agents.save': { en: 'Save', zh: '保存' },
  'agents.cancel': { en: 'Cancel', zh: '取消' },
  'agents.restore': { en: 'Restore built-in', zh: '恢复内置' },
  'agents.delete': { en: 'Delete', zh: '删除' },
  'agents.title': { en: 'Subagents', zh: '子代理' },
  'agents.sub': { en: 'Identities the model can hand research work to', zh: '模型可交付调研工作的身份' },
  'agents.tip': { en: 'Built-in ones can be rewritten; custom ones are stored in the folder below.', zh: '内置的可以改写，自定义的保存在下面的文件夹里。' },
  'agents.openFolder': { en: 'Open folder', zh: '打开文件夹' },
  'agents.newOnly': { en: 'Applies to new sessions', zh: '新会话生效' },
  'agents.builtin': { en: 'Built-in', zh: '内置' },
  'agents.overridden': { en: 'Built-in, rewritten', zh: '已改写内置' },
  'agents.custom': { en: 'Custom', zh: '自定义' },
  'agents.editBtn': { en: 'Edit', zh: '编辑' },

  'plugins.installing': { en: 'Installing…', zh: '安装中…' },
  'plugins.updating': { en: 'Updating…', zh: '更新中…' },
  'plugins.removing': { en: 'Removing…', zh: '移除中…' },
  'plugins.installed': { en: 'Installed; new sessions will load it', zh: '已安装，新会话生效' },
  'plugins.removeTitle': { en: 'Remove {source}?', zh: '移除 {source}？' },
  'plugins.removeBody': { en: 'Its skills, commands and tools are gone from new sessions.', zh: '它的技能、命令和工具在新会话中不再可用。' },
  'plugins.remove': { en: 'Remove', zh: '移除' },
  'plugins.removed': { en: 'Removed', zh: '已移除' },
  'plugins.title': { en: 'Plugins', zh: '插件' },
  'plugins.sub': { en: 'pi packages: skills, prompts, extensions, MCP', zh: 'pi 包：技能、提示、扩展、MCP' },
  'plugins.tip': { en: 'One install can bring skills, prompt templates, extensions and MCP servers. The source can be npm, git or a local folder.', zh: '一次安装可带来技能、提示模板、扩展和 MCP 服务器。来源可以是 npm、git 或本地文件夹。' },
  'plugins.updatedAll': { en: 'Updated all plugins', zh: '已更新全部插件' },
  'plugins.updateAll': { en: 'Update all', zh: '全部更新' },
  'plugins.install': { en: 'Install a plugin', zh: '安装插件' },
  'plugins.personal': { en: 'Personal', zh: '个人' },
  'plugins.projectOpt': { en: 'Project', zh: '项目' },
  'plugins.installBtn': { en: 'Install', zh: '安装' },
  'plugins.firstInstall': { en: '{busy} The first install may take a while.', zh: '{busy} 首次安装可能较慢。' },
  'plugins.projectScope': { en: '{name} only; written to .pi/settings.json', zh: '仅 {name}；写入 .pi/settings.json' },
  'plugins.userScope': { en: 'Every project; written to settings.json', zh: '所有项目；写入 settings.json' },
  'plugins.filtered': { en: 'Filtered', zh: '已过滤' },
  'plugins.filteredHint': { en: 'Settings limit which resources it loads', zh: '设置里限制了它加载哪些资源' },
  'plugins.notInstalled': { en: 'Not installed', zh: '未安装' },
  'plugins.notInstalledHint': { en: 'Not installed; a new session will try to install it', zh: '未安装；新会话启动时会尝试安装' },
  'plugins.update': { en: 'Update', zh: '更新' },
  'plugins.updated': { en: 'Updated {source}', zh: '已更新 {source}' },
  'plugins.recommended': { en: 'Recommended', zh: '推荐' },
  'plugins.lensDesc': { en: 'Code intelligence: LSP diagnostics, syntax trees, linters, type checks.', zh: '代码智能：LSP 诊断、语法树、lint、类型检查。' },
  'plugins.items': { en: 'Contents', zh: '内容' },
  'plugins.itemsEmpty': { en: 'Nothing to configure.', zh: '没有可配置的内容。' },
  'plugins.itemsTip': { en: 'Turn off parts of a package, such as extensions that duplicate desktop features. Applies to new sessions.', zh: '可单独关闭包里的部分内容，比如与桌面端功能重复的扩展。新会话生效。' },
  'plugins.kind.extensions': { en: 'Extensions', zh: '扩展' },
  'plugins.kind.skills': { en: 'Skills', zh: '技能' },
  'plugins.kind.prompts': { en: 'Prompts', zh: '提示词' },
  'plugins.kind.themes': { en: 'Themes', zh: '主题' },
  'plugins.empty': { en: 'No plugins yet. Enter a package name above, e.g. npm:pi-web-access.', zh: '还没有插件。在上面输入包名，如 npm:pi-web-access。' },

  'customize.tab.recommended': { en: 'Recommended', zh: '推荐' },
  'rec.sub': { en: 'One-click setups for common work', zh: '常见工作的一键配置' },
  'rec.tip': { en: 'Skills are written to your personal skills folder and can be edited there. Plugins and connectors are installed for every project. New sessions pick them up.', zh: '技能会写入个人技能文件夹，可随意修改。插件和连接器对所有项目生效。新会话生效。' },
  'rec.group.create': { en: 'Slides, video, audio', zh: 'PPT、视频、音频' },
  'rec.group.roles': { en: 'Roles', zh: '角色' },
  'rec.install': { en: 'Install', zh: '安装' },
  'rec.installed': { en: 'Installed', zh: '已安装' },
  'rec.done': { en: 'Installed; new sessions will use it', zh: '已安装，新会话生效' },
  'rec.kind.skill': { en: 'Skill', zh: '技能' },
  'rec.kind.plugin': { en: 'Plugin', zh: '插件' },
  'rec.kind.connector': { en: 'Connector', zh: '连接器' },

  'rec.slides.title': { en: 'Slides', zh: 'PPT 制作' },
  'rec.slides.desc': { en: 'Build .pptx decks with code, with a layout checklist', zh: '用代码生成 .pptx，附排版清单' },
  'rec.slides.skillDesc': { en: 'Create or revise slide decks and presentations (.pptx, PDF, Slidev). Use when asked for slides, a deck, a pitch or a talk.', zh: '制作或修改幻灯片、演示文稿（.pptx、PDF、Slidev）。用户要做 PPT、汇报、路演、演讲稿时使用。' },
  'rec.slides.body': {
    en: `# Slides

## Plan first
1. Ask for audience, goal and time if they are missing. Settle the one message each slide carries.
2. Outline as a list of slide titles written as claims, not topics. Confirm with the user before building.

## Build
- Editable .pptx: write a Node script with \`pptxgenjs\` (\`npm i pptxgenjs\`). Define a master slide with fonts, colors and margins once, then fill slides from data.
- Web or PDF: use Slidev (\`npx slidev\`, Markdown source; \`npx slidev export\` for PDF).
- Charts: draw native charts with the library instead of pasting images, so numbers stay editable.
- Save the generator script next to the deck so changes are a re-run, not a redo.

## Layout rules
- One idea per slide, at most 6 lines, body text 18pt or more.
- Two fonts at most and one accent color. Left-align text. Keep margins consistent.
- Prefer a diagram, chart or number over a paragraph. Every image has a purpose.
- Put detail in speaker notes, not on the slide.

## Check
Render to images (LibreOffice: \`soffice --headless --convert-to pdf\`), look at every slide, and fix overflow, overlap and uneven spacing before reporting.`,
    zh: `# 制作 PPT

## 先规划
1. 缺少受众、目标、时长就先问。确定每页只讲一个观点。
2. 先列大纲：每页标题写成结论，不写话题。确认后再动手。

## 生成
- 可编辑的 .pptx：写 Node 脚本，用 \`pptxgenjs\`（\`npm i pptxgenjs\`）。先定义母版（字体、配色、边距），再用数据填充各页。
- 网页或 PDF：用 Slidev（\`npx slidev\`，Markdown 源文件；\`npx slidev export\` 导出 PDF）。
- 图表用库自带的原生图表，不要贴图，数字才能继续编辑。
- 生成脚本和成品放在一起，改动时重跑即可，不必重做。

## 排版规则
- 一页一个观点，最多 6 行，正文不小于 18pt。
- 字体最多两种，强调色一种。文字左对齐，边距一致。
- 能用图、图表、数字，就不用大段文字。每张图都要有用途。
- 细节放进演讲者备注，不放在页面上。

## 检查
渲染成图片（LibreOffice：\`soffice --headless --convert-to pdf\`），逐页查看，修好溢出、重叠、间距不齐后再交付。`,
  },

  'rec.remotion.title': { en: 'Video (Remotion)', zh: '视频制作（Remotion）' },
  'rec.remotion.desc': { en: 'Write videos as React code; official skills', zh: '用 React 代码做视频，官方技能包' },
  'rec.tts.title': { en: 'Free speech synthesis', zh: '免费语音合成' },
  'rec.tts.desc': { en: 'Edge voices, no API key; outputs MP3 and word timings. Needs uv', zh: '微软 Edge 音色，免 API Key，输出 MP3 和逐词时间。需要 uv' },
  'rec.voiceover.title': { en: 'Voiceover and audio', zh: '配音与音频' },
  'rec.voiceover.desc': { en: 'Script, synthesize and mix narration for videos', zh: '写稿、合成、混音，给视频配旁白' },
  'rec.voiceover.skillDesc': { en: 'Generate narration, voiceover and audio files from text with free TTS, and mix them with video. Use when asked for audio, dubbing or a read-aloud.', zh: '用免费 TTS 把文字合成旁白、配音、音频文件，并与视频混音。用户要音频、配音、朗读时使用。' },
  'rec.voiceover.body': {
    en: `# Voiceover

## Script
Write for the ear: short sentences, no symbols or tables. Spell out numbers and abbreviations. One paragraph per scene.

## Synthesize (free)
1. If an \`edge-tts\` connector is available, use its tools: they return MP3 and word timings.
2. Otherwise use the CLI: \`pip install edge-tts\`, then \`edge-tts --voice zh-CN-XiaoxiaoNeural --text "..." --write-media out.mp3 --write-subtitles out.vtt\`. List voices with \`edge-tts --list-voices\`.
3. Fully offline: Kokoro (\`pip install kokoro-onnx\`), better for English.
- Chinese voices: zh-CN-XiaoxiaoNeural (warm), zh-CN-YunxiNeural (young male), zh-CN-YunjianNeural (narration). English: en-US-AriaNeural, en-US-GuyNeural.

## Use with video
- Remotion: put the MP3 in \`public/\`, add it with \`<Audio>\`, and derive scene length from the audio duration (\`calculateMetadata\`) or the word timings. Use the timings for captions.
- Otherwise mix with ffmpeg: \`ffmpeg -i video.mp4 -i voice.mp3 -c:v copy -map 0:v -map 1:a -shortest out.mp4\`. Lower music under speech to about -18 dB.

## Check
Listen to the first sentence before synthesizing everything. Fix pronunciation with punctuation or a respelling.`,
    zh: `# 配音

## 写稿
按“听”来写：短句，不用符号和表格。数字、缩写写成读法。一个场景一段。

## 合成（免费）
1. 有 \`edge-tts\` 连接器就直接用它的工具，会返回 MP3 和逐词时间。
2. 没有就用命令行：\`pip install edge-tts\`，然后 \`edge-tts --voice zh-CN-XiaoxiaoNeural --text "..." --write-media out.mp3 --write-subtitles out.vtt\`。\`edge-tts --list-voices\` 查看全部音色。
3. 完全离线：Kokoro（\`pip install kokoro-onnx\`），英文效果更好。
- 中文音色：zh-CN-XiaoxiaoNeural（温暖）、zh-CN-YunxiNeural（年轻男声）、zh-CN-YunjianNeural（解说）。英文：en-US-AriaNeural、en-US-GuyNeural。

## 配合视频
- Remotion：MP3 放进 \`public/\`，用 \`<Audio>\` 引入；用 \`calculateMetadata\` 按音频时长，或按逐词时间决定场景长度，字幕也用逐词时间。
- 其他情况用 ffmpeg 混音：\`ffmpeg -i video.mp4 -i voice.mp3 -c:v copy -map 0:v -map 1:a -shortest out.mp4\`。背景音乐在说话时压到约 -18 dB。

## 检查
先合成第一句试听，再合成全部。读音不对就调标点或改写成同音字。`,
  },

  'rec.pm.title': { en: 'Product manager', zh: '互联网产品经理' },
  'rec.pm.desc': { en: 'PRDs, prioritization, metrics, competitor analysis', zh: 'PRD、优先级、指标、竞品分析' },
  'rec.pm.skillDesc': { en: 'Product management work: PRDs, user stories, prioritization, metrics, competitor analysis, launch plans. Use when asked to define, scope or evaluate a product or feature.', zh: '产品经理工作：PRD、用户故事、优先级、指标、竞品分析、上线计划。用户要定义、拆解、评估产品或功能时使用。' },
  'rec.pm.body': {
    en: `# Product manager

Work like a senior internet product manager. Start from the problem and the evidence, not the feature.

## Before writing
Ask only for what is missing: who the user is, the problem and how often it happens, the business goal, constraints, and what success looks like.

## PRD structure
1. Background and problem: who, what pain, evidence (data, interviews, tickets).
2. Goals and non-goals, with metrics: one primary metric, guardrail metrics, a target and a deadline.
3. Users and scenarios: key personas and the main flow.
4. Requirements: user stories with acceptance criteria (Given/When/Then). Mark each P0/P1/P2.
5. Flow and rules: states, edge cases, permissions, empty/error states, copy that needs review.
6. Data and tracking: events and properties needed to measure the metrics.
7. Release: rollout plan, A/B test, dependencies, risks, rollback.
8. Open questions and owners.

## Prioritizing
Score with RICE (reach, impact, confidence, effort) and show the numbers. Cut scope to the smallest version that tests the main assumption.

## Competitor analysis
Compare on the same dimensions: target user, core flow, pricing, strengths, gaps. End with what to copy, avoid and exploit.

## Style
Short sentences, tables for comparisons, flow charts in Mermaid. Every requirement must be testable. Flag assumptions as assumptions.`,
    zh: `# 产品经理

按资深互联网产品经理的方式工作：从问题和证据出发，不从功能出发。

## 动笔前
只问缺的信息：用户是谁、问题是什么、多常发生、业务目标、约束、怎样算成功。

## PRD 结构
1. 背景与问题：谁、什么痛点、证据（数据、访谈、工单）。
2. 目标与非目标，附指标：一个核心指标、护栏指标、目标值和时间。
3. 用户与场景：关键用户画像和主流程。
4. 需求：用户故事加验收标准（Given/When/Then），标注 P0/P1/P2。
5. 流程与规则：状态、边界情况、权限、空状态/异常状态、需要审核的文案。
6. 数据与埋点：衡量指标所需的事件和属性。
7. 发布：灰度方案、AB 实验、依赖、风险、回滚。
8. 待确认问题与负责人。

## 优先级
用 RICE（触达、影响、信心、成本）打分并给出数字。把范围砍到能验证核心假设的最小版本。

## 竞品分析
用同一组维度对比：目标用户、核心流程、定价、优势、短板。最后写清要借鉴什么、避开什么、从哪里切入。

## 风格
短句；对比用表格；流程图用 Mermaid。每条需求都能被测试。假设要标明是假设。`,
  },

  'rec.arch.title': { en: 'Architect', zh: '架构师' },
  'rec.arch.desc': { en: 'System design, trade-offs, ADRs, reviews', zh: '系统设计、方案取舍、ADR、评审' },
  'rec.arch.skillDesc': { en: 'Architecture work: system design, technology choices, API and data modeling, ADRs, design reviews, capacity and failure analysis. Use when asked to design or review a system.', zh: '架构师工作：系统设计、技术选型、接口与数据建模、ADR、方案评审、容量与故障分析。用户要设计或评审系统时使用。' },
  'rec.arch.body': {
    en: `# Architect

Read the existing code and infrastructure before proposing anything. Design for the requirements actually given, not for imagined scale.

## Clarify
Functional scope, scale (users, QPS, data volume, growth), latency and availability targets, consistency needs, team size and skills, budget, deadlines, compliance. State assumptions for anything unknown.

## Design document
1. Context and goals, non-goals.
2. Constraints and quality attributes, ranked.
3. Overview: a C4 context/container diagram in Mermaid.
4. Components and their responsibilities and boundaries.
5. Data model and storage choice, with access patterns.
6. APIs and key flows (sequence diagrams for the critical ones).
7. Cross-cutting: security, observability, deployment, configuration.
8. Capacity estimate with the arithmetic shown.
9. Failure modes: what breaks, how it is detected, how it recovers.
10. Rollout and migration plan.
11. Risks and open questions.

## Decisions
For each significant choice give 2-3 options, the trade-offs against the ranked quality attributes, and a recommendation. Record it as an ADR: context, decision, consequences, alternatives.

## Review checklist
Single points of failure, unbounded queues or retries, hot keys, data ownership, backward compatibility, operability at 3am, cost, and how the design gets simpler, not just bigger.

## Style
Prefer boring technology. Say what you would not build yet. Keep diagrams small and labeled.`,
    zh: `# 架构师

提方案前先读现有代码和基础设施。按实际给出的需求设计，不为想象中的规模设计。

## 澄清
功能范围、规模（用户数、QPS、数据量、增长）、延迟与可用性目标、一致性要求、团队规模与技能、预算、工期、合规。未知项写明假设。

## 设计文档
1. 背景、目标、非目标。
2. 约束与质量属性，按优先级排序。
3. 总览：Mermaid 的 C4 上下文/容器图。
4. 组件及其职责、边界。
5. 数据模型与存储选型，写明访问模式。
6. 接口与关键流程（关键链路用时序图）。
7. 横切关注点：安全、可观测性、部署、配置。
8. 容量估算，写出计算过程。
9. 故障模式：什么会坏、如何发现、如何恢复。
10. 上线与迁移方案。
11. 风险与待确认问题。

## 决策
每个重要选择给出 2-3 个方案，对照排序后的质量属性写取舍，并给出推荐。用 ADR 记录：背景、决策、后果、备选方案。

## 评审清单
单点故障、无界队列或重试、热点 key、数据归属、向后兼容、凌晨三点能否运维、成本，以及方案是在变简单还是只是在变大。

## 风格
优先成熟技术。说明哪些现在不做。图要小而有标注。`,
  },

  'rec.design.title': { en: 'UI designer', zh: '设计师' },
  'rec.design.desc': { en: 'Design specs, visual systems, design reviews', zh: '设计规范、视觉体系、设计评审' },
  'rec.design.skillDesc': { en: 'UI/UX design work: user flows, wireframes, design systems, visual specs, accessibility, design reviews, and building the result as HTML/CSS. Use when asked to design or critique an interface.', zh: 'UI/UX 设计工作：用户流程、线框、设计系统、视觉规范、无障碍、设计评审，并用 HTML/CSS 落地。用户要设计或评审界面时使用。' },
  'rec.design.body': {
    en: `# UI designer

Design for the task the user is trying to finish. Look at the existing product and its design tokens first; extend them instead of inventing a second style.

## Process
1. Goal: who, what task, on which device, what "done" looks like.
2. Flow: the steps, with entry, exit and the error path. Mermaid is fine.
3. Structure: wireframe each screen in plain boxes before any color. Decide hierarchy: one primary action per screen.
4. States: default, hover, focus, active, disabled, loading, empty, error, success.
5. Visual: set tokens once (color, type scale, spacing on a 4/8 grid, radius, shadow, motion), then apply.
6. Build: prototype as HTML/CSS when asked, using the tokens as CSS variables. Check it in a browser at phone and desktop widths.

## Visual rules
- Hierarchy by size, weight and space before color. One accent color; grays carry the rest.
- Type scale of 5-6 steps, body at least 14px, line height 1.5. Chinese text needs a CJK font stack.
- Contrast 4.5:1 for text, targets at least 44px on touch, visible focus rings.
- Align to the grid. Related things sit closer than unrelated things.
- Support dark mode through tokens, not copies.

## Design review
Rate each finding by severity. Cover task fit, hierarchy, consistency with the system, states, copy, accessibility and responsive behavior. Give a concrete fix for each problem.

## Handoff
List tokens, components with states, spacing, copy and assets, so an engineer needs no guesswork.`,
    zh: `# UI 设计师

围绕用户要完成的任务来设计。先看现有产品和它的设计 token，在其基础上扩展，不另起一套风格。

## 流程
1. 目标：谁、做什么任务、什么设备、怎样算完成。
2. 流程：步骤、入口、出口和出错路径。可用 Mermaid。
3. 结构：先用方框画每屏线框，不上色。定层级：每屏一个主操作。
4. 状态：默认、悬停、聚焦、按下、禁用、加载、空、错误、成功。
5. 视觉：一次定好 token（颜色、字阶、4/8 栅格间距、圆角、阴影、动效），再套用。
6. 落地：被要求时用 HTML/CSS 做原型，token 写成 CSS 变量。在浏览器里按手机和桌面宽度检查。

## 视觉规则
- 层级先靠字号、字重、留白，再靠颜色。强调色一种，其余用灰阶。
- 字阶 5-6 级，正文不小于 14px，行高 1.5。中文需要中文字体栈。
- 文字对比度 4.5:1，触控目标不小于 44px，保留可见的聚焦框。
- 对齐栅格。相关的元素靠近，无关的拉开。
- 深色模式通过 token 实现，不复制一份。

## 设计评审
按严重程度给每条问题分级。覆盖任务匹配、层级、与体系一致性、状态、文案、无障碍、响应式。每个问题给出具体改法。

## 交付
列出 token、带状态的组件、间距、文案和素材，让工程师无需猜测。`,
  },
});
