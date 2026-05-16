import { spawnSync } from "node:child_process";

const validationSteps = [
  ["pnpm", ["arch:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test:unit"]],
  ["pnpm", ["test:e2e"]],
  ["pnpm", ["build"]],
  ["pnpm", ["perf:baseline"]],
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
];

const packageSteps = [
  ["pnpm", ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"]],
];

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "check";
const stepsByMode = {
  validate: validationSteps,
  package: packageSteps,
  check: [...validationSteps, ...packageSteps],
};
const steps = stepsByMode[mode];
if (!steps) {
  console.error(`[release-check-win-x64] unknown mode: ${mode}`);
  process.exit(1);
}

for (const [command, args] of steps) {
  const label = [command, ...args].join(" ");
  console.log(`\n[release-check-win-x64:${mode}] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const status = result.status ?? 1;
    console.error(`[release-check-win-x64:${mode}] failed: ${label} (exit ${status})`);
    process.exit(status);
  }
}

console.log(`\n[release-check-win-x64:${mode}] Windows x64 release ${mode} gate passed.`);
