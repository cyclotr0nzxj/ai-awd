#!/usr/bin/env node
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BIN_DIR = path.join(__dirname, "..", "bin");
const OWNER = "openclaw";
const REPO = "openclaw";

function platformKey() {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin") return a === "arm64" ? "darwin-arm64" : "darwin-amd64";
  if (p === "win32") return "windows-amd64";
  if (p === "linux") return "linux-amd64";
  throw new Error(`Unsupported platform: ${p} ${a}`);
}

async function latestRelease() {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path: `/repos/${OWNER}/${REPO}/releases/latest`,
      headers: { "User-Agent": "ai-awd-installer", Accept: "application/vnd.github+json" },
    };
    https.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const tag = json.tag_name || "v0.0.0";
          const assets = json.assets || [];
          resolve({ tag, assets });
        } catch (e) {
          reject(new Error("Failed to parse release JSON"));
        }
      });
    }).on("error", reject);
  });
}

/**
 * Match the actual GitHub release asset naming (v2026.6.5+):
 *   macOS:  OpenClaw-{version}.zip  (universal .app bundle)
 *   Windows: OpenClawCompanion-Setup-x64.exe (installer, no standalone CLI zip)
 */
function assetForPlatform(assets, plat) {
  if (plat.startsWith("darwin")) {
    // macOS universal: OpenClaw-2026.6.5.zip
    return assets.find((a) => /^OpenClaw-\d+\.\d+\.\d+\.zip$/i.test(a.name)) || null;
  }
  if (plat.startsWith("windows")) {
    // Windows ships an installer, not a standalone CLI zip.
    // Look for x64 installer as the best available option.
    const exe = assets.find((a) => /Setup-x64\.exe$/i.test(a.name));
    if (exe) return exe;
    // Fallback: any .exe or .zip with "windows" or "Setup" in the name
    return assets.find((a) => /(?:windows|setup).*(?:amd64|x64).*\.(?:exe|zip)$/i.test(a.name)) || null;
  }
  // Linux: try tar.gz with linux in the name
  return assets.find((a) => /linux.*(?:amd64|x86_64).*\.tar\.gz$/i.test(a.name)) || null;
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
  });
}

/**
 * Extract the openclaw CLI binary from a macOS OpenClaw.app bundle.
 * The CLI lives at: OpenClaw.app/Contents/Resources/app.asar.unpacked/node_modules/.bin/openclaw
 * (or a similar path — we search for any "openclaw" executable inside the .app).
 */
function extractFromAppBundle(zipDir, dest) {
  // The .zip extracts to ./OpenClaw.app/...
  const appDir = path.join(zipDir, "OpenClaw.app");
  if (!fs.existsSync(appDir)) {
    throw new Error("OpenClaw.app not found in extracted zip");
  }

  // Search for the openclaw binary inside the app bundle
  function findBinary(dir, depth) {
    if (depth > 8) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return null; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.name === "openclaw" && !e.isDirectory()) {
        try {
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        } catch (_) { /* not executable */ }
      }
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        const found = findBinary(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  const binary = findBinary(appDir, 0);
  if (!binary) {
    throw new Error("Could not find openclaw binary inside OpenClaw.app bundle");
  }
  fs.copyFileSync(binary, dest);
}

/**
 * Install openclaw via npm as a local package.
 * Creates a shim at bin/openclaw that can be used by the Electron app.
 */
function installViaNpm() {
  const clientDir = path.join(__dirname, "..");
  const npmBinDir = path.join(clientDir, "node_modules", ".bin");
  const shimName = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const shimPath = path.join(npmBinDir, shimName);

  // Check if already installed via npm
  if (fs.existsSync(shimPath)) {
    try {
      const out = execSync(`"${shimPath}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
      console.log(`openclaw (npm) already available: ${out}`);
      // Symlink/copy to bin dir
      fs.mkdirSync(BIN_DIR, { recursive: true });
      const dest = path.join(BIN_DIR, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
      if (!fs.existsSync(dest)) {
        // Create a wrapper that calls the npm-installed version
        if (process.platform === "win32") {
          fs.writeFileSync(dest, `@echo off\r\n"${shimPath}" %*`);
        } else {
          fs.writeFileSync(dest, `#!/bin/sh\nexec "${shimPath}" "$@"`);
          fs.chmodSync(dest, 0o755);
        }
      }
      return true;
    } catch (_) { /* not working */ }
  }

  console.log("Installing openclaw via npm...");
  try {
    execSync("npm install openclaw --no-save --no-audit --no-fund", {
      cwd: clientDir,
      stdio: "pipe",
      timeout: 120000,
    });
    console.log("openclaw npm package installed successfully.");

    // Create wrapper in bin/
    if (fs.existsSync(shimPath)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
      const dest = path.join(BIN_DIR, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
      if (process.platform === "win32") {
        fs.writeFileSync(dest, `@echo off\r\n"${shimPath}" %*`);
      } else {
        fs.writeFileSync(dest, `#!/bin/sh\nexec "${shimPath}" "$@"`);
        fs.chmodSync(dest, 0o755);
      }
    }
    return true;
  } catch (npmErr) {
    console.error(`npm install openclaw failed: ${npmErr.message}`);
    return false;
  }
}

async function main() {
  const plat = platformKey();
  const exeName = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const dest = path.join(BIN_DIR, exeName);

  // Skip if bundle directory already has a working binary
  if (fs.existsSync(dest)) {
    try {
      const out = execSync(`"${dest}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
      console.log(`openclaw already bundled: ${out} at ${dest}`);
      return;
    } catch (_) { /* not working, re-download */ }
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  // ── Strategy: try GitHub release first, fall back to npm ──
  console.log(`Fetching latest OpenClaw release for ${plat}...`);
  let tag = "unknown";
  try {
    const release = await latestRelease();
    tag = release.tag;
    const asset = assetForPlatform(release.assets, plat);

    if (asset) {
      console.log(`Found asset: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)`);

      // Windows installer — can't extract CLI from .exe, skip to npm
      if (asset.name.endsWith(".exe")) {
        console.log("Windows installer detected — CLI not extractable. Falling back to npm...");
      } else {
        const tmpFile = dest + ".download";
        await download(asset.browser_download_url, tmpFile);

        if (asset.name.endsWith(".zip")) {
          // Extract
          if (process.platform === "win32") {
            // PowerShell Expand-Archive
            execSync(`powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${BIN_DIR}' -Force"`, { stdio: "pipe" });
          } else {
            execSync(`unzip -o "${tmpFile}" -d "${BIN_DIR}"`, { stdio: "pipe" });
          }
          fs.unlinkSync(tmpFile);

          // For macOS, the .zip contains OpenClaw.app — extract CLI from bundle
          if (plat.startsWith("darwin")) {
            try {
              extractFromAppBundle(BIN_DIR, dest);
              // Clean up extracted .app
              const appDir = path.join(BIN_DIR, "OpenClaw.app");
              fs.rmSync(appDir, { recursive: true, force: true });
            } catch (extractErr) {
              console.error(`Failed to extract CLI from .app bundle: ${extractErr.message}`);
              console.log("Falling back to npm...");
              if (installViaNpm()) return;
              console.log("Could not auto-download OpenClaw. Please install it manually: npm install -g openclaw");
              return;
            }
          } else {
            // Linux: find and rename the binary
            const files = fs.readdirSync(BIN_DIR);
            const binary = files.find(f => f.startsWith("openclaw") && !f.endsWith(".download"));
            if (binary && binary !== exeName) {
              fs.renameSync(path.join(BIN_DIR, binary), dest);
            }
          }
        } else if (asset.name.endsWith(".tar.gz")) {
          execSync(`tar -xzf "${tmpFile}" -C "${BIN_DIR}"`, { stdio: "pipe" });
          fs.unlinkSync(tmpFile);
          const files = fs.readdirSync(BIN_DIR);
          const binary = files.find(f => f.startsWith("openclaw") && !f.endsWith(".download"));
          if (binary && binary !== exeName) {
            fs.renameSync(path.join(BIN_DIR, binary), dest);
          }
        }

        // Verify
        if (fs.existsSync(dest)) {
          if (!plat.startsWith("windows")) {
            fs.chmodSync(dest, 0o755);
          }
          try {
            const out = execSync(`"${dest}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
            console.log(`✅ OpenClaw ${tag} ready: ${out}`);
            return;
          } catch (_) {
            console.log("⚠️  Binary extracted but --version check failed. Falling back to npm...");
          }
        }
      }
    } else {
      console.log(`No prebuilt binary for ${plat} in ${tag}.`);
    }
  } catch (releaseErr) {
    console.error(`GitHub release fetch failed: ${releaseErr.message}`);
  }

  // ── Fallback: npm install ──
  console.log("Trying npm fallback...");
  if (installViaNpm()) {
    console.log("✅ OpenClaw installed via npm.");
    return;
  }

  const installHint = process.platform === "darwin"
    ? "brew install openclaw"
    : process.platform === "win32"
      ? "npm install -g openclaw   OR   download from https://github.com/openclaw/openclaw/releases"
      : "npm install -g openclaw";
  console.log(`Could not auto-download OpenClaw. Please install it manually: ${installHint}`);
  console.log("The app will fall back to locally installed openclaw if available.");
}

main().catch((err) => {
  console.error(`⚠️  OpenClaw download failed: ${err.message}`);
  console.log("The app will fall back to locally installed openclaw if available.");
  process.exit(0); // Never fail the install
});
