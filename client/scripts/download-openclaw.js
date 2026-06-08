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

function assetForPlatform(assets, plat) {
  const pattern = plat === "windows-amd64"
    ? /windows.*amd64.*\.zip$/i
    : new RegExp(`${plat.replace("-", ".*")}\\.tar\\.gz$`, "i");
  return assets.find((a) => pattern.test(a.name)) || null;
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); fs.unlinkSync(dest).catch(() => {}); reject(err); });
  });
}

async function main() {
  const plat = platformKey();
  const exeName = plat.startsWith("windows") ? "openclaw.exe" : "openclaw";
  const dest = path.join(BIN_DIR, exeName);

  // Skip if bundle directory already has a binary
  if (fs.existsSync(dest)) {
    try {
      const out = execSync(`"${dest}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
      console.log(`openclaw already bundled: ${out} at ${dest}`);
      return;
    } catch (_) { /* not working, re-download */ }
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  console.log(`Fetching latest OpenClaw release for ${plat}...`);
  const { tag, assets } = await latestRelease();
  const asset = assetForPlatform(assets, plat);
  if (!asset) {
    console.log(`No prebuilt binary for ${plat} in ${tag}. Trying common URL pattern...`);
    // Fallback: direct download URL pattern
    const ext = plat.startsWith("windows") ? "zip" : "tar.gz";
    const fallbackUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/openclaw_${plat}.${ext}`;
    console.log(`Fallback: ${fallbackUrl}`);
    // For now, skip if no matching asset — user can install manually
    console.log("Could not auto-download OpenClaw. Please install it manually: brew install openclaw");
    return;
  }

  const tmpFile = dest + ".download";
  console.log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)}MB)...`);
  await download(asset.browser_download_url, tmpFile);

  // Extract
  if (asset.name.endsWith(".tar.gz")) {
    execSync(`tar -xzf "${tmpFile}" -C "${BIN_DIR}"`, { stdio: "pipe" });
    fs.unlinkSync(tmpFile);
    // Find the extracted binary and rename
    const files = fs.readdirSync(BIN_DIR);
    const binary = files.find(f => f.startsWith("openclaw") && !f.endsWith(".download"));
    if (binary && binary !== exeName) {
      fs.renameSync(path.join(BIN_DIR, binary), dest);
    }
  } else if (asset.name.endsWith(".zip")) {
    execSync(`unzip -o "${tmpFile}" -d "${BIN_DIR}"`, { stdio: "pipe" });
    fs.unlinkSync(tmpFile);
  }

  // Make executable
  if (!plat.startsWith("windows")) {
    fs.chmodSync(dest, 0o755);
  }

  // Verify
  try {
    const out = execSync(`"${dest}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
    console.log(`✅ OpenClaw ${tag} ready: ${out}`);
  } catch (_) {
    console.log(`⚠️  Binary downloaded but --version check failed. It may still work.`);
  }
}

main().catch((err) => {
  console.error(`⚠️  OpenClaw download failed: ${err.message}`);
  console.log("The app will fall back to locally installed openclaw if available.");
  process.exit(0); // Never fail the install
});
