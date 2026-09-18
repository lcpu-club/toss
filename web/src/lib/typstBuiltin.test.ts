import { describe, expect, it } from "vitest";
import {
  packageCatalogHints,
  type BuiltinTypstCatalog
} from "@/lib/typstBuiltin";

function catalog(
  local_packages: BuiltinTypstCatalog["local_packages"],
  universe_seeds: BuiltinTypstCatalog["universe_seeds"]
): BuiltinTypstCatalog {
  return {
    schema: 2,
    local_packages,
    universe_seeds,
    font_bundles: []
  };
}

describe("packageCatalogHints", () => {
  it("builds fully-qualified specs from local and seeded packages", () => {
    const hints = packageCatalogHints(
      catalog(
        [{ namespace: "local", name: "helper", version: "0.0.1", artifact_path: "", sha256: "", size_bytes: 0 }],
        [{ namespace: "preview", name: "example", version: "0.1.0", artifact_path: "", sha256: "", size_bytes: 0 }]
      )
    );
    expect(hints).toEqual([
      { spec: "@local/helper:0.0.1" },
      { spec: "@preview/example:0.1.0" }
    ]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(packageCatalogHints(catalog([], []))).toEqual([]);
  });
});
