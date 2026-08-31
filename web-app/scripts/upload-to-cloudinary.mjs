#!/usr/bin/env node
/**
 * Cloudinary Asset Uploader for Behörden-Bot Scroll Cinematic
 *
 * Uploads all 4 stills and 7 video clips from public/scroll/ to Cloudinary,
 * maintaining the folder structure (e.g. `scroll/dream.png`, `scroll/vid/dream.mp4`).
 *
 * Usage:
 *   CLOUDINARY_URL="cloudinary://<api_key>:<api_secret>@<cloud_name>" node scripts/upload-to-cloudinary.mjs
 *   OR set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in your .env
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCROLL_DIR = path.resolve(__dirname, "../public/scroll");

// Parse Cloudinary credentials
let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
let apiKey = process.env.CLOUDINARY_API_KEY;
let apiSecret = process.env.CLOUDINARY_API_SECRET;

if (process.env.CLOUDINARY_URL) {
  const match = process.env.CLOUDINARY_URL.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (match) {
    apiKey = match[1];
    apiSecret = match[2];
    cloudName = match[3];
  }
}

if (!cloudName || !apiKey || !apiSecret) {
  console.error("\n❌ Missing Cloudinary credentials!");
  console.error(
    "Please provide CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.\n",
  );
  console.error("Example:");
  console.error(
    '  CLOUDINARY_URL="cloudinary://123456:abcdef@my-cloud-name" node scripts/upload-to-cloudinary.mjs\n',
  );
  process.exit(1);
}

// Generate Cloudinary signature
async function signUpload(params, secret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const stringToSign = `${sorted}${secret}`;

  const crypto = await import("node:crypto");
  return crypto.createHash("sha1").update(stringToSign).digest("hex");
}

async function uploadFile(filePath, publicId, resourceType = "image") {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    public_id: publicId,
    timestamp: timestamp.toString(),
    use_filename: "true",
    unique_filename: "false",
    overwrite: "true",
  };

  const signature = await signUpload(params, apiSecret);
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = resourceType === "video" ? "video/mp4" : "image/png";
  const blob = new Blob([fileBuffer], { type: mimeType });

  formData.append("file", blob, path.basename(filePath));
  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp.toString());
  formData.append("public_id", publicId);
  formData.append("use_filename", "true");
  formData.append("unique_filename", "false");
  formData.append("overwrite", "true");
  formData.append("signature", signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
  const res = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.secure_url;
}

async function main() {
  console.log(`\n🚀 Uploading Scroll Cinematic assets to Cloudinary (${cloudName})...\n`);

  const stills = ["dream.png", "docs.png", "aps.png", "campus.png"];
  const videos = [
    "dream.mp4",
    "conn1.mp4",
    "docs.mp4",
    "conn2.mp4",
    "aps.mp4",
    "conn3.mp4",
    "campus.mp4",
  ];

  console.log("📸 Uploading still posters...");
  for (const still of stills) {
    const fullPath = path.join(SCROLL_DIR, still);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  ⚠️ Skipping missing file: ${still}`);
      continue;
    }
    const publicId = `scroll/${path.parse(still).name}`;
    process.stdout.write(`  • Uploading ${still}... `);
    const url = await uploadFile(fullPath, publicId, "image");
    console.log(`✅ ${url}`);
  }

  console.log("\n🎬 Uploading video clips...");
  for (const vid of videos) {
    const fullPath = path.join(SCROLL_DIR, "vid", vid);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  ⚠️ Skipping missing video: ${vid}`);
      continue;
    }
    const publicId = `scroll/vid/${path.parse(vid).name}`;
    process.stdout.write(`  • Uploading vid/${vid}... `);
    const url = await uploadFile(fullPath, publicId, "video");
    console.log(`✅ ${url}`);
  }

  console.log("\n🎉 All assets uploaded successfully!");
  console.log("\nNext step: Add this to your .env or production environment variables:");
  console.log(`SCROLL_ASSETS_URL="https://res.cloudinary.com/${cloudName}"\n`);
}

main().catch((err) => {
  console.error("\n❌ Upload failed:", err.message);
  process.exit(1);
});
