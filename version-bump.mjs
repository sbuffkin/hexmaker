import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

const manifestPath = "manifest.json";
const versionsPath = "versions.json";

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t"));

const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, "\t"));

console.log("Bumped version to", targetVersion);
