/**
 * Editor-facing compile diagnostics. Mirrors the worker's CompileDiagnostic
 * but stays decoupled from the compilation module so the editor layer has a
 * narrow, stable contract.
 */
export type EditorDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  /** Normalized relative file path the diagnostic belongs to. */
  path?: string;
  /** 1-based line number. */
  line?: number;
  /** 1-based column number. */
  column?: number;
};
