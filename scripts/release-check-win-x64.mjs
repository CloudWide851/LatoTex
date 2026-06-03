import { spawnSync } from "node:child_process";

const validationSteps = [
  ["pnpm", ["arch:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test:unit"]],
  ["pnpm", ["test:e2e"]],
  ["pnpm", ["build"]],
  ["pnpm", ["perf:baseline"]],
  ["pnpm", ["soak:matrix"]],
  ["pnpm", ["security:scan"]],
  ["pnpm", ["sbom:generate", "--", "--check"]],
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
];

const packageSteps = [
  ["pnpm", ["release:build-installer:win-x64"]],
  ["pnpm", ["release:hash:win-x64"]],
  ["pnpm", ["tauri:smoke:win-x64", "--", "--allow-native-fallback"], { retries: 1 }],
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

for (const [command, args, options = {}] of steps) {
  const label = [command, ...args].join(" ");
  const maxAttempts = Number(options.retries ?? 0) + 1;
  let finalStatus = 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptLabel = maxAttempts > 1 ? `${label} (attempt ${attempt}/${maxAttempts})` : label;
    console.log(`\n[release-check-win-x64:${mode}] ${attemptLabel}`);
    const result = spawnSync(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    finalStatus = result.status ?? 1;
    if (finalStatus === 0) {
      break;
    }
    if (attempt < maxAttempts) {
      console.warn(`[release-check-win-x64:${mode}] retrying after failed step: ${label} (exit ${finalStatus})`);
    }
  }
  if (finalStatus !== 0) {
    console.error(`[release-check-win-x64:${mode}] failed: ${label} (exit ${finalStatus})`);
    process.exit(finalStatus);
  }
}

console.log(`\n[release-check-win-x64:${mode}] Windows x64 release ${mode} gate passed.`);
