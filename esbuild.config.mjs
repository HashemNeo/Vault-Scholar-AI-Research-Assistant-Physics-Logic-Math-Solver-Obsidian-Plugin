import esbuild from "esbuild";
import process from "process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";

const context = await esbuild.context({
    banner: { js: "'use strict'" },
    entryPoints: [path.join(__dirname, "src/main.ts")],
    bundle: true,
    external: ["obsidian", "electron", "fs", "path", "crypto", "child_process", "vm"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: path.join(__dirname, "main.js"),
    allowOverwrite: true,
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}