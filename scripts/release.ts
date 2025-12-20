#!/usr/bin/env tsx
/**
 * Release script - bumps version, commits, tags, and pushes
 *
 * Usage:
 *   pnpm run release:patch   # 2.2.0 -> 2.2.1
 *   pnpm run release:minor   # 2.2.0 -> 2.3.0
 *   pnpm run release:major   # 2.2.0 -> 3.0.0
 *   pnpm run release 2.5.0   # explicit version
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function exec(command: string, options?: { quiet?: boolean }): string {
  try {
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: options?.quiet ? 'pipe' : 'inherit',
      cwd: join(__dirname, '..')
    });
    return output as string;
  } catch (error) {
    if (!options?.quiet) {
      throw error;
    }
    return '';
  }
}

type BumpType = 'major' | 'minor' | 'patch';

function bumpVersion(current: string, type: BumpType | string): string {
  // If it's an explicit version, validate and return it
  if (/^\d+\.\d+\.\d+/.test(type)) {
    return type;
  }

  const parts = current.split('.').map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

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
    console.error('Usage: pnpm run release <patch|minor|major|x.y.z>');
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = exec('git status --porcelain', { quiet: true });
  if (status.trim()) {
    console.error('Error: Working directory has uncommitted changes');
    console.error('Please commit or stash changes before releasing');
    process.exit(1);
  }

  // Read current version
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\n📦 Release: ${currentVersion} → ${newVersion}\n`);

  // Update package.json
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('✓ Updated package.json');

  // Run tests
  console.log('⏳ Running tests...');
  try {
    exec('pnpm test', { quiet: true });
    console.log('✓ Tests passed');
  } catch {
    console.error('✗ Tests failed - aborting release');
    exec('git checkout package.json', { quiet: true });
    process.exit(1);
  }

  // Run typecheck
  console.log('⏳ Running typecheck...');
  try {
    exec('pnpm run typecheck', { quiet: true });
    console.log('✓ Typecheck passed');
  } catch {
    console.error('✗ Typecheck failed - aborting release');
    exec('git checkout package.json', { quiet: true });
    process.exit(1);
  }

  // Commit and tag
  const tag = `v${newVersion}`;
  exec('git add package.json');
  exec(`git commit -m "chore: release ${tag}"`);
  exec(`git tag ${tag}`);
  console.log(`✓ Created commit and tag: ${tag}`);

  // Push
  console.log('⏳ Pushing to origin...');
  exec('git push origin main --tags');
  console.log('✓ Pushed to origin');

  console.log(`\n🎉 Released ${tag}!`);
  console.log(`   GitHub Actions will create the release automatically.`);
  console.log(`   View at: https://github.com/optilo/impi-scraper/releases/tag/${tag}\n`);
}

main().catch(err => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
