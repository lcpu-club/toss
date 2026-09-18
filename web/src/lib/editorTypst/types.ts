/**
 * Editor-intelligence wire types for the Typst workspace editor.
 *
 * The Typst language engine (autocomplete and tooltips) runs inside the
 * browser compiler worker on the same world a preview compile uses — shadow
 * sources, fonts, and the package registry — so completions resolve against
 * the exact library and packages the document compiles with. These types are
 * the plain, serializable contract between that engine and the CodeMirror
 * layer; offset conventions are UTF-16 code units (editor space) at this
 * boundary.
 */

/** The kind of thing a completion inserts (see the engine's `CompletionKind`). */
export type TypstCompletionKind =
  | "syntax"
  | "func"
  | "type"
  | "param"
  | "constant"
  | "path"
  | "package"
  | "label"
  | "font"
  | "symbol";

/** A single completion candidate from the engine. */
export type TypstCompletionItem = {
  kind: string;
  label: string;
  /**
   * Insertion text in typst-ide snippet syntax (`${name}` placeholders).
   * Absent for plain text insertions.
   */
  apply?: string;
  /** Short supporting text (parameter types, symbol glyphs, descriptions). */
  detail?: string;
};

/** Completions at a caret: the replacement start plus the options. */
export type TypstCompletion = {
  /** UTF-16 code unit offset where the replacement begins. */
  from: number;
  completions: TypstCompletionItem[];
};

/** A hover tooltip from the engine. */
export type TypstHover = {
  kind: "text" | "code";
  value: string;
};

/** A query the editor sends to the language engine. */
export type TypstIntelligenceQuery =
  | {
      kind: "autocomplete";
      /** UTF-16 caret offset in the buffer. */
      pos: number;
      /** The full current buffer text (engine refreshes its shadow file). */
      content: string;
      /** True when the user explicitly requested completion. */
      explicit: boolean;
    }
  | {
      kind: "hover";
      pos: number;
      content: string;
    };

/** Answers intelligence queries. Resolves `null` when there is no result. */
export type TypstIntelligenceResponder = (
  query: TypstIntelligenceQuery
) => Promise<TypstCompletion | TypstHover | null>;
