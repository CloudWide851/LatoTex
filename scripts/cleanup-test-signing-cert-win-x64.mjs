#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const thumbprint = process.env.LATOTEX_TEST_SIGNING_CERT_THUMBPRINT;
if (process.platform !== "win32" || !thumbprint) {
  process.exit(0);
}
if (!/^[A-Fa-f0-9]{40}$/.test(thumbprint)) {
  console.error("[cleanup-test-signing-cert-win-x64] invalid test certificate thumbprint.");
  process.exit(1);
}

for (const store of ["Root", "TrustedPublisher", "My"]) {
  spawnSync("certutil.exe", ["-user", "-delstore", store, thumbprint], {
    encoding: "utf8",
    stdio: "ignore",
  });
}
console.log("[cleanup-test-signing-cert-win-x64] removed local test signing certificate.");
