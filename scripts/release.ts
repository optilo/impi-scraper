#!/usr/bin/env bun
/**
 * Release script - bumps version, commits, tags, and pushes
 *
 * Usage:
 *   bun scripts/release.ts patch   # 2.2.0 -> 2.2.1
 *   bun scripts/release.ts minor   # 2.2.0 -> 2.3.0
 *   bun scripts/release.ts major   # 2.2.0 -> 3.0.0
 *   bun scripts/release.ts 2.5.0   # explicit version
 */

import { $ } from "bun";

type BumpType = 'major' | 'minor' | 'patch';

function bumpVersion(current: string, type: BumpType | string): string {
  // If it's an explicit version, validate and return it
  if (/^\d+\.\d+\.\d+/.test(type)) {
    return type;
  }

  const [major, minor, patch] = current.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}. Use major, minor, patch, or explicit version.`);
  }
}

async function main() {
  const bumpType = process.argv[2];

  if (!bumpType) {
    console.error('Usage: bun scripts/release.ts <patch|minor|major|x.y.z>');
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = await $`git status --porcelain`.text();
  if (status.trim()) {
    console.error('Error: Working directory has uncommitted changes');
    console.error('Please commit or stash changes before releasing');
    process.exit(1);
  }

  // Read current version
  const pkg = await Bun.file('package.json').json();
  const currentVersion = pkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\n📦 Release: ${currentVersion} → ${newVersion}\n`);

  // Update package.json
  pkg.version = newVersion;
  await Bun.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('✓ Updated package.json');

  // Run tests
  console.log('⏳ Running tests...');
  try {
    await $`bun test src/`.quiet();
    console.log('✓ Tests passed');
  } catch {
    console.error('✗ Tests failed - aborting release');
    await $`git checkout package.json`.quiet();
    process.exit(1);
  }

  // Run typecheck
  console.log('⏳ Running typecheck...');
  try {
    await $`bun run typecheck`.quiet();
    console.log('✓ Typecheck passed');
  } catch {
    console.error('✗ Typecheck failed - aborting release');
    await $`git checkout package.json`.quiet();
    process.exit(1);
  }

  // Commit and tag
  const tag = `v${newVersion}`;
  await $`git add package.json`;
  await $`git commit -m ${'chore: release ' + tag}`;
  await $`git tag ${tag}`;
  console.log(`✓ Created commit and tag: ${tag}`);

  // Push
  console.log('⏳ Pushing to origin...');
  await $`git push origin main --tags`;
  console.log('✓ Pushed to origin');

  console.log(`\n🎉 Released ${tag}!`);
  console.log(`   GitHub Actions will create the release automatically.`);
  console.log(`   View at: https://github.com/optilo/impi-scraper/releases/tag/${tag}\n`);
}

main().catch(err => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
