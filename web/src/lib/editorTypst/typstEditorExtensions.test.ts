import { describe, expect, it } from "vitest";
import {
  CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  typstCompletionSource,
  typstCompletionValidFor,
  typstSnippetToTemplate
} from "@/lib/editorTypst/typstEditorExtensions";
import type {
  TypstCompletion,
  TypstCompletionItem
} from "@/lib/editorTypst/types";

/**
 * Re-implementation of CodeMirror's completion liveness gate
 * (`checkValid` + `ensureAnchor` in @codemirror/autocomplete): the popup
 * stays open while `validFor` still matches the document span between the
 * result's `from` and the cursor.
 */
function checkValid(validFor: RegExp, text: string): boolean {
  const addStart = validFor.source[0] !== "^";
  const addEnd = validFor.source[validFor.source.length - 1] !== "$";
  const anchored =
    addStart || addEnd
      ? new RegExp(
          `${addStart ? "^" : ""}(?:${validFor.source})${addEnd ? "$" : ""}`,
          validFor.flags
        )
      : validFor;
  return anchored.test(text);
}

type CompletionResult = NonNullable<Awaited<ReturnType<CompletionSource>>>;

/**
 * Drives the engine-backed source with a real `CompletionContext` (no editor
 * view needed) and asserts that the liveness gate accepts the span between
 * the result's `from` and the end of the document.
 */
async function sourceResult(
  doc: string,
  engineFrom: number,
  completions: TypstCompletionItem[],
  pos = doc.length
): Promise<CompletionResult> {
  const state = EditorState.create({ doc });
  const responder: (query: never) => Promise<TypstCompletion | null> = () =>
    Promise.resolve({ from: engineFrom, completions });
  const result = await typstCompletionSource(responder as never)(
    new CompletionContext(state, pos, false)
  );
  expect(result, `expected completions in ${JSON.stringify(doc)}`).not.toBeNull();
  const done = result as CompletionResult;
  return done;
}

function expectGate(
  done: CompletionResult,
  doc: string,
  pos = doc.length,
  expected = true
) {
  const span = doc.slice(done.from, pos);
  expect(
    checkValid(done.validFor as RegExp, span),
    `liveness gate should be ${expected} for span ${JSON.stringify(span)}`
  ).toBe(expected);
}

describe("typstSnippetToTemplate", () => {
  it("converts typst-ide placeholders to CodeMirror placeholders", () => {
    expect(typstSnippetToTemplate("heading(${title})")).toBe(
      "heading(#{title})"
    );
  });

  it("converts multiple placeholders in order", () => {
    expect(typstSnippetToTemplate("link(${dest})[${content}]")).toBe(
      "link(#{dest})[#{content}]"
    );
  });

  it("escapes literal braces that are not placeholders", () => {
    expect(typstSnippetToTemplate("a { b } ${x}")).toBe("a \\{ b \\} #{x}");
  });

  it("keeps plain text unchanged", () => {
    expect(typstSnippetToTemplate("plain")).toBe("plain");
  });

  it("keeps a $ that is not followed by { and escapes stray braces", () => {
    expect(typstSnippetToTemplate("$ { x")).toBe("$ \\{ x");
  });
});

describe("typstCompletionValidFor", () => {
  it.each([
    ["", true],
    ["in", true],
    ["intro", true],
    ["@pre", true],
    ["@previ", true],
    ['"', true],
    ['"@pre', true],
    ['"@previ', true],
    ['"@preview/example:0.1.0', true],
    ["sub", true],
    ["src/fig", true],
    ["a b", false],
    ['"@pre"', false],
    ['"@pre" ', false],
    ["in(", false],
    ["@pre ", false]
  ])("gate %j -> %s", (span, expected) => {
    expect(checkValid(typstCompletionValidFor, span)).toBe(expected);
  });
});

describe("typstCompletionSource", () => {
  it("anchors label completions after the @ marker", async () => {
    const doc = "= Intro <intro>\nSee @in";
    const from = doc.lastIndexOf("@") + 1;
    const done = await sourceResult(doc, from, [
      { kind: "label", label: "intro" },
      { kind: "label", label: "introduction" }
    ]);
    expect(done.from).toBe(from);
    expect(done.options.map((o) => o.label)).toEqual([
      "intro",
      "introduction"
    ]);
    expectGate(done, doc);
  });

  it("keeps the popup alive while an import string is being typed", async () => {
    // The engine anchors import completions at the string's opening quote
    // (`ctx.from = ctx.leaf.offset()` in typst-ide), so every span while
    // typing an unterminated import starts with a quote. Regression: the
    // previous pattern rejected `"@pre` and closed the popup mid-typing.
    const packages: TypstCompletionItem[] = [
      {
        kind: "package",
        label: '"@preview/example:0.1.0"',
        apply: '"@preview/example:0.1.0"'
      },
      {
        kind: "package",
        label: '"@local/helper:0.0.1"',
        apply: '"@local/helper:0.0.1"'
      }
    ];
    const quote = '#import "'.length - 1;
    for (const rest of ["", "p", "pre", "previ", "preview/example"]) {
      const doc = `#import "${rest}`;
      const done = await sourceResult(doc, quote, packages);
      expect(done.from).toBe(quote);
      expectGate(done, doc);
    }
  });

  it("keeps file import completions alive while the path is typed", async () => {
    const quote = '#import "'.length - 1;
    for (const rest of ["", "s", "sub", "src/fig"]) {
      const doc = `#import "${rest}`;
      const done = await sourceResult(doc, quote, [
        { kind: "path", label: "sub.typ" }
      ]);
      expectGate(done, doc);
    }
  });

  it("drops the result once the string is closed and typing moved on", async () => {
    const doc = '#import "@prev"';
    const quote = 8;
    const done = await sourceResult(doc, quote, [
      { kind: "package", label: '"@prev"' }
    ]);
    // The span now contains the closing quote: the stale result must
    // invalidate so the popup re-queries at the new context.
    expectGate(done, doc, doc.length, false);
  });

  it("clamps the engine's from into the active span", async () => {
    const doc = '#import "@pre';
    const ahead = await sourceResult(doc, doc.length + 20, [
      { kind: "package", label: '"@pre"' }
    ]);
    expect(ahead.from).toBe(doc.length);

    const behind = await sourceResult(doc, -1, [
      { kind: "package", label: '"@pre"' }
    ]);
    expect(behind.from).toBe(0);
  });
});
