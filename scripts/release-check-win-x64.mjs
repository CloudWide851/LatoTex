import { spawnSync } from "node:child_process";

const steps = [
  ["pnpm", ["arch:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test:unit"]],
  ["pnpm", ["test:e2e"]],
  ["pnpm", ["build"]],
  ["pnpm", ["perf:baseline"]],
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["pnpm", ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"]],
];

for (const [command, args] of steps) {
  const label = [command, ...args].join(" ");
  console.log(`\n[release-check-win-x64] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const status = result.status ?? 1;
    console.error(`[release-check-win-x64] failed: ${label} (exit ${status})`);
    process.exit(status);
  }
}

console.log("\n[release-check-win-x64] Windows x64 release gate passed.");
