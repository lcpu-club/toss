import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
import {
  lintGutter,
  setDiagnostics,
  type Diagnostic as LintDiagnostic
} from "@codemirror/lint";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  hoverTooltip,
  type Tooltip,
  type ViewUpdate
} from "@codemirror/view";
import type { EditorDiagnostic } from "@/lib/editorTypst/diagnostics";
import type {
  TypstCompletionItem,
  TypstIntelligenceResponder
} from "@/lib/editorTypst/types";

/** typst-ide `CompletionKind` -> CodeMirror completion `type` (icons). */
const KIND_TO_TYPE: Record<string, string> = {
  syntax: "keyword",
  func: "function",
  type: "type",
  param: "property",
  constant: "constant",
  path: "text",
  package: "namespace",
  label: "text",
  font: "text",
  symbol: "constant"
};

/**
 * Trigger pattern: a run of characters immediately before the cursor that
 * may be part of a completion target. This is the liveness-span alphabet
 * (`typstCompletionValidFor`) plus `#`, where import spans begin at the
 * string's opening quote and references and dotted accesses contribute
 * `@` and `.`. The `+` keeps the engine unqueried at positions where no
 * completion target can start (after whitespace, at line starts, ...).
 */
const WORD_PATTERN = /["\w.#@:/-]+$/;

/**
 * Convert typst-ide snippet syntax into a CodeMirror template. Both dialects
 * use `${name}` placeholders; CodeMirror additionally treats literal `{`/`}`
 * as template delimiters, so those are escaped in the surrounding text.
 */
export function typstSnippetToTemplate(apply: string): string {
  let out = "";
  for (let i = 0; i < apply.length; i += 1) {
    const char = apply[i];
    if (char === "$" && apply[i + 1] === "{") {
      const close = apply.indexOf("}", i + 2);
      if (close === -1) {
        out += char;
        continue;
      }
      out += `#{${apply.slice(i + 2, close)}}`;
      i = close;
      continue;
    }
    if (char === "{" || char === "}") {
      out += `\\${char}`;
      continue;
    }
    out += char;
  }
  return out;
}

function toCompletionOption(item: TypstCompletionItem): Completion {
  const isSnippet = !!item.apply && item.apply !== item.label;
  return {
    label: item.label,
    type: KIND_TO_TYPE[item.kind] ?? "text",
    detail: item.detail,
    info: item.detail,
    apply:
      isSnippet && item.apply
        ? snippet(typstSnippetToTemplate(item.apply))
        : (item.apply ?? item.label)
  };
}

/**
 * Liveness predicate for the CodeMirror completion result: the popup stays
 * open while the text between the engine's completion start and the cursor
 * still matches it (CodeMirror re-runs the source as soon as it does not).
 * Import completions are anchored at the string's opening quote, so those
 * spans start with `"`; every other span is a bare identifier or path
 * fragment. Any other character (a closing quote, whitespace, punctuation)
 * invalidates the result so the popup follows the new completion context.
 */
export const typstCompletionValidFor = /^"?[\w.#@:/-]*$/;

/**
 * The engine-backed completion source. The engine call is parse-only (no
 * layout), so it runs on every trigger; the completion popup discards stale
 * responses itself. Exported so tests can drive it with a real
 * `CompletionContext` without a mounted editor view.
 */
export function typstCompletionSource(
  responder: TypstIntelligenceResponder
): CompletionSource {
  return async (
    context: CompletionContext
  ): Promise<Awaited<ReturnType<CompletionSource>>> => {
    if (!context.explicit && !context.matchBefore(WORD_PATTERN)) return null;
    const content = context.state.doc.toString();
    let result: Awaited<ReturnType<TypstIntelligenceResponder>>;
    try {
      result = await responder({
        kind: "autocomplete",
        pos: context.pos,
        content,
        explicit: context.explicit
      });
    } catch {
      return null;
    }
    if (!result || "value" in result || result.completions.length === 0) {
      return null;
    }
    return {
      from: Math.max(0, Math.min(result.from, context.pos)),
      options: result.completions.map(toCompletionOption),
      validFor: typstCompletionValidFor
    };
  };
}

/**
 * Autocompletion wired to the Typst language engine.
 */
export function typstCompletionExtension(
  responder: TypstIntelligenceResponder
): Extension {
  return autocompletion({
    override: [typstCompletionSource(responder)],
    activateOnTyping: true
  });
}

/** Hover tooltip backed by the Typst language engine (signatures and docs). */
export function typstHoverExtension(responder: TypstIntelligenceResponder): Extension {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      if (!view.state.selection.main.empty) return null;
      const content = view.state.doc.toString();
      let hover: Awaited<ReturnType<TypstIntelligenceResponder>>;
      try {
        hover = await responder({ kind: "hover", pos, content });
      } catch {
        return null;
      }
      if (!hover || "completions" in hover || !hover.value?.trim()) return null;
      const hoverValue = hover.value;
      const hoverKind = hover.kind;
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "typst-hover";
          if (hoverKind === "code") {
            const pre = document.createElement("pre");
            pre.className = "typst-hover-code";
            pre.textContent = hoverValue;
            dom.appendChild(pre);
          } else {
            dom.textContent = hoverValue;
          }
          return { dom };
        }
      };
    },
    { hoverTime: 350 }
  );
}

/** The active file's compile diagnostics, as supplied by the workspace. */
export type TypstEditorDiagnostics = Readonly<{
  path: string;
  diagnostics: readonly EditorDiagnostic[];
}>;

export const setTypstEditorDiagnosticsEffect = StateEffect.define<TypstEditorDiagnostics>();

/**
 * Holds the workspace's latest diagnostics for the active file so the lint
 * plugin can re-map them whenever either side changes.
 */
export const typstEditorDiagnosticsField = StateField.define<TypstEditorDiagnostics>({
  create: () => ({ path: "", diagnostics: [] }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTypstEditorDiagnosticsEffect)) return effect.value;
    }
    return value;
  }
});

function lineColumnToOffset(state: EditorState, line?: number, column?: number) {
  if (!line || line < 1) return 0;
  const docLine = state.doc.line(Math.min(line, state.doc.lines));
  const col = Math.max(1, column ?? 1);
  return Math.min(docLine.from + col - 1, state.doc.length);
}

function mapDiagnostics(
  state: EditorState,
  diagnostics: readonly EditorDiagnostic[],
  path: string
): LintDiagnostic[] {
  const mapped: LintDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.path && diagnostic.path !== path) continue;
    const from = lineColumnToOffset(state, diagnostic.line, diagnostic.column);
    let to = from;
    // Keep a visible (non-zero-width) span for the gutter marker.
    if (to === from && to < state.doc.length) to += 1;
    mapped.push({
      from,
      to,
      severity:
        diagnostic.severity === "warning"
          ? "warning"
          : diagnostic.severity === "info"
            ? "info"
            : "error",
      message: diagnostic.message,
      source: "typst"
    });
  }
  return mapped;
}

/**
 * Maps the active file's compile diagnostics into the lint layer. Re-runs
 * when the text or the supplied diagnostics change so markers stay attached
 * through edits (the lint layer itself resets its own state on doc changes).
 */
const diagnosticsPlugin = ViewPlugin.fromClass(
  class {
    applied: LintDiagnostic[] = [];

    constructor(view: EditorView) {
      this.remap(view);
    }

    update(update: ViewUpdate) {
      if (
        !update.docChanged &&
        update.state.field(typstEditorDiagnosticsField) ===
          update.startState.field(typstEditorDiagnosticsField)
      ) {
        return;
      }
      this.remap(update.view);
    }

    private remap(view: EditorView) {
      const { path, diagnostics } = view.state.field(typstEditorDiagnosticsField);
      this.applied = mapDiagnostics(view.state, diagnostics, path);
      view.dispatch(setDiagnostics(view.state, this.applied));
    }
  }
);

/** All extensions for an intelligence-enabled Typst document. */
export function typstIntelligenceExtensions(
  responder: TypstIntelligenceResponder
): Extension[] {
  return [
    typstCompletionExtension(responder),
    typstHoverExtension(responder),
    typstEditorDiagnosticsField,
    diagnosticsPlugin,
    lintGutter()
  ];
}
