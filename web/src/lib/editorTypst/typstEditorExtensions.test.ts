import { describe, expect, it } from "vitest";
import {
  typstSnippetToTemplate
} from "@/lib/editorTypst/typstEditorExtensions";

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
