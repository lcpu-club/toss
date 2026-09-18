import { useCallback, useMemo } from "react";
import { typstAutocomplete, typstHover } from "@/lib/typst";
import type {
  TypstCompletion,
  TypstHover,
  TypstIntelligenceQuery,
  TypstIntelligenceResponder
} from "@/lib/editorTypst/types";

type UseTypstIntelligenceInput = {
  /** The compiler worker's workspace key (compile world scope). */
  workspaceKey: string;
  /** The workspace entry file. */
  entryFilePath: string;
  /** The document currently shown in the editor. */
  activePath: string;
  /** True while the active file is a Typst document the editor is editing. */
  active: boolean;
};

/**
 * Answers editor-intelligence queries (completion and hover) through the
 * browser compiler worker, where the Typst language engine runs against the
 * same world a preview compile uses.
 *
 * Returns a stable `{ responder, activePath }` (or `null` when the active
 * file is not an editable Typst document). The responder is keyed only on the
 * workspace, entry, and active file — never on diagnostics — so the
 * CodeMirror extensions built from it are not reconfigured when compile
 * diagnostics refresh.
 */
export function useTypstIntelligence({
  workspaceKey,
  entryFilePath,
  activePath,
  active
}: UseTypstIntelligenceInput) {
  const responder = useCallback<TypstIntelligenceResponder>(
    async (query: TypstIntelligenceQuery) => {
      if (query.kind === "autocomplete") {
        const result: TypstCompletion | null = await typstAutocomplete({
          workspaceKey,
          entryFilePath,
          file: activePath,
          cursor: query.pos,
          explicit: query.explicit,
          content: query.content
        });
        return result;
      }
      const result: TypstHover | null = await typstHover({
        workspaceKey,
        entryFilePath,
        file: activePath,
        cursor: query.pos,
        content: query.content
      });
      return result;
    },
    [workspaceKey, entryFilePath, activePath]
  );

  return useMemo(
    () => (active ? { responder, activePath } : null),
    [active, activePath, responder]
  );
}
