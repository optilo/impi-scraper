---
description: Use pnpm for package management, tsx for running TypeScript.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using pnpm and tsx.

- Use `pnpm install` for installing dependencies
- Use `pnpm run <script>` to run scripts from package.json
- Use `tsx <file>` to run TypeScript files directly
- Use `pnpm exec <command>` instead of `npx <command>`
- Use `vitest` for testing (configured in vitest.config.ts)
- Use Node.js built-in APIs (fs, child_process, etc.) instead of Bun-specific APIs

## Testing

Use `vitest` to run tests.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## File Operations

Use Node.js built-in `fs` module for file operations:

```ts
import { readFileSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';

// Synchronous
const data = readFileSync('file.json', 'utf-8');
writeFileSync('output.json', JSON.stringify(data, null, 2));

// Async
const data = await readFile('file.json', 'utf-8');
await writeFile('output.json', JSON.stringify(data, null, 2));
```

## Process Execution

Use Node.js `child_process` for executing shell commands:

```ts
import { execSync } from 'child_process';

const output = execSync('git status --porcelain', { encoding: 'utf-8' });
```

## Git Workflow

**IMPORTANT**: Do NOT commit or push changes automatically.
- You may stage changes with `git add`
- Wait for user to do manual QA and verification before committing
- Only commit when explicitly asked by the user

## Releases

When the user asks to create a release, use the release script:

```bash
# Patch release (bug fixes): 2.2.0 -> 2.2.1
pnpm run release:patch

# Minor release (new features): 2.2.0 -> 2.3.0
pnpm run release:minor

# Major release (breaking changes): 2.2.0 -> 3.0.0
pnpm run release:major

# Explicit version
pnpm run release 2.5.0
```

The script will:
1. Check for uncommitted changes (fails if dirty)
2. Bump version in package.json
3. Run tests and typecheck
4. Commit with message "chore: release vX.Y.Z"
5. Create git tag vX.Y.Z
6. Push to origin (triggers GitHub Actions to create release)

**Version guidelines**:
- `patch`: Bug fixes, documentation updates, refactoring
- `minor`: New features, non-breaking API additions
- `major`: Breaking changes to existing API
