import ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const files = ["src/app/globals.css", "src/components/modules/home-objectives.module.css", "src/components/modules/home-institutional-images.module.css", "src/components/modules/home-module.tsx", "src/components/modules/home-institutional-images.tsx", "src/components/modules/home-objective-catalog.tsx"];
export function signature(path, content) {
  let normalized = content.replaceAll("\r\n", "\n");
  if (path.endsWith(".tsx")) {
    const source = ts.createSourceFile(path, normalized, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const elements = [];
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        elements.push([node.tagName.getText(source), ...node.attributes.properties.filter(p => ts.isJsxAttribute(p) && ["className", "style"].includes(p.name.getText(source))).map(p => p.getText(source))]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source); normalized = JSON.stringify(elements);
  }
  return createHash("sha256").update(normalized).digest("hex");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  const hashes = Object.fromEntries(files.map(path => [path, signature(path, base ? execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8"))]));
  writeFileSync("src/lib/home-layout-baseline.json", JSON.stringify({ base, hashes }, null, 2) + "\n");
}
