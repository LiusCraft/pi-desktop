import { createCodemodeExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { TODO_TOOL } from '@shared/todo-message';

/** Keep the checklist shortcut visible even when the SDK hides direct tools in Codemode-only mode. */
export const desktopCodemode: ExtensionFactory = (pi) =>
  createCodemodeExtension()({
    ...pi,
    registerTool(tool) {
      const prepare = tool.prepareLoadout;
      pi.registerTool(
        !prepare
          ? tool
          : {
              ...tool,
              prepareLoadout(loadout) {
                const result = prepare(loadout);
                return {
                  ...result,
                  hiddenDeclarations: result?.hiddenDeclarations?.filter((name) => name !== TODO_TOOL),
                };
              },
            },
      );
    },
  });
