#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.error("[create-test-signing-pfx-win-x64] Windows test certificate generation must run on Windows.");
  process.exit(1);
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "latotex-test-signing-"));
const keyPath = path.join(outDir, "test-signing.key.pem");
const certPath = path.join(outDir, "test-signing.cert.pem");
const pfxPath = path.join(outDir, "test-signing.pfx");
const configPath = path.join(outDir, "openssl.cnf");
const password = `latotex-test-${randomBytes(18).toString("base64url")}`;

fs.writeFileSync(configPath, [
  "[req]",
  "distinguished_name=req_distinguished_name",
  "x509_extensions=v3_codesign",
  "prompt=no",
  "[req_distinguished_name]",
  "CN=LatoTex Local Test Signing",
  "[v3_codesign]",
  "basicConstraints=critical,CA:true",
  "keyUsage=critical,digitalSignature,keyCertSign",
  "extendedKeyUsage=codeSigning",
  "subjectKeyIdentifier=hash",
  "authorityKeyIdentifier=keyid:always,issuer",
  "",
].join("\n"), "utf8");

try {
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "7",
    "-nodes",
    "-sha256",
    "-config",
    configPath,
  ], "create self-signed test certificate", {
    env: { ...process.env, OPENSSL_CONF: configPath },
  });
  run("openssl", [
    "pkcs12",
    "-export",
    "-out",
    pfxPath,
    "-inkey",
    keyPath,
    "-in",
    certPath,
    "-passout",
    `pass:${password}`,
  ], "export test PFX");
  const fingerprint = run("openssl", ["x509", "-in", certPath, "-fingerprint", "-sha1", "-noout"], "read thumbprint");
  const thumbprint = fingerprint.split("=").pop()?.replaceAll(":", "").trim();
  if (!thumbprint || !/^[A-Fa-f0-9]{40}$/.test(thumbprint)) {
    throw new Error("could not parse generated test certificate thumbprint");
  }
  const pfxBase64 = fs.readFileSync(pfxPath).toString("base64");
  console.log("# PowerShell environment for local test signing only. Do not use for official releases.");
  console.log(`$env:LATOTEX_SIGN_CERT_PFX_BASE64='${pfxBase64}'`);
  console.log(`$env:LATOTEX_SIGN_CERT_PASSWORD='${password}'`);
  console.log("$env:LATOTEX_SIGN_TIMESTAMP_URL='http://timestamp.digicert.com'");
  console.log("$env:LATOTEX_TEST_SIGNING_CERT='1'");
  console.log("$env:LATOTEX_ALLOW_TEST_SIGNING='1'");
  console.log("$env:LATOTEX_TEST_SIGNING_ALLOW_NO_TIMESTAMP='1'");
  console.log("$env:LATOTEX_REQUIRE_SIGNING='1'");
  console.log(`$env:LATOTEX_TEST_SIGNING_CERT_THUMBPRINT='${thumbprint}'`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
