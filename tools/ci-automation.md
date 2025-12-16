# CI/CD Automation for Cursor Agent

This setup enables the Cursor agent to automatically:
1. Push code to GitHub
2. Monitor CI job status
3. Retrieve build logs on failure
4. Iterate until CI passes

## Setup

### 1. Install GitHub CLI

```bash
# macOS
brew install gh

# Or download from: https://cli.github.com/
```

### 2. Authenticate GitHub CLI

```bash
gh auth login
# Follow prompts to authenticate with your GitHub account
```

### 3. Grant Required Permissions

The GitHub CLI needs access to:
- Read workflow runs
- Read workflow logs
- Read repository status

These are typically granted during `gh auth login`.

### 4. Test the Tool

```bash
# Make a test commit
git commit --allow-empty -m "test ci monitoring"
git push

# Get the commit SHA
COMMIT_SHA=$(git rev-parse HEAD)

# Test monitoring
pnpm tsx tools/ci-feedback.ts $COMMIT_SHA
```

## Usage in Cursor Agent

When the agent needs to push code and wait for CI:

```typescript
// Agent workflow:
// 1. Make code changes
// 2. Commit and push
execSync('git add . && git commit -m "fix: ..." && git push');

// 3. Get commit SHA
const commitSha = execSync('git rev-parse HEAD').toString().trim();

// 4. Monitor CI
const result = execSync(`pnpm tsx tools/ci-feedback.ts ${commitSha}`, {
  encoding: 'utf-8',
  stdio: 'pipe'
});

// If exit code is 0: success, continue
// If exit code is 1: failure, logs are in stdout, fix and retry
```

## Agent Prompt Template

Add this to your agent instructions:

```
When pushing code that triggers CI:
1. Commit and push changes
2. Run: pnpm tsx tools/ci-feedback.ts $(git rev-parse HEAD)
3. If CI fails:
   - Analyze the error logs from the tool output
   - Fix the issues in the code
   - Repeat steps 1-3 until CI passes
4. If CI passes, report success and await next task
```

## Alternative: GitHub Actions API (No CLI Required)

If you prefer not to use GitHub CLI, you can use the GitHub REST API directly.
Create a token at: https://github.com/settings/tokens

Then modify `tools/ci-feedback.ts` to use `fetch` instead of `gh` commands.

