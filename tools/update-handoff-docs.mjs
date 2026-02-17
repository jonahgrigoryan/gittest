#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AGENTS_PATH = "AGENTS.md";
const PROGRESS_PATH = "progress.md";
const SECTION_TITLE = "## Auto Handoff Log";
const SECTION_START = "<!-- AUTO_HANDOFF_START -->";
const SECTION_END = "<!-- AUTO_HANDOFF_END -->";

function git(args, allowFail = false) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

function refExists(ref) {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", ref], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function ensureSection(content) {
  if (content.includes(SECTION_START) && content.includes(SECTION_END)) {
    return content;
  }

  const trimmed = content.replace(/\s*$/, "");
  return `${trimmed}\n\n${SECTION_TITLE}\n${SECTION_START}\n${SECTION_END}\n`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertEntry(content, branch, entry) {
  const startIdx = content.indexOf(SECTION_START);
  const endIdx = content.indexOf(SECTION_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error("Auto handoff section markers are missing or malformed.");
  }

  const before = content.slice(0, startIdx + SECTION_START.length);
  const after = content.slice(endIdx);
  let body = content.slice(startIdx + SECTION_START.length, endIdx);

  const escapedBranch = escapeRegex(branch);
  const existingEntryPattern = new RegExp(
    `\\n?<!-- AUTO_HANDOFF_ENTRY:${escapedBranch}:start -->[\\s\\S]*?<!-- AUTO_HANDOFF_ENTRY:${escapedBranch}:end -->\\n?`,
    "g"
  );
  body = body.replace(existingEntryPattern, "\n");
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const combined = body.length > 0 ? `${entry}\n\n${body}` : entry;
  return `${before}\n${combined}\n${after}`;
}

function writeUpdatedFile(filePath, branch, entry) {
  const absPath = path.resolve(process.cwd(), filePath);
  const original = fs.readFileSync(absPath, "utf8");
  const withSection = ensureSection(original);
  const updated = upsertEntry(withSection, branch, entry);
  fs.writeFileSync(absPath, updated, "utf8");
}

function formatChangedFiles(files) {
  if (files.length === 0) {
    return "`(only AGENTS.md/progress.md changes)`";
  }
  return files.map((file) => `\`${file}\``).join(", ");
}

function main() {
  const args = process.argv.slice(2);
  const baseBranch = args[0] ?? "origin/main";
  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = args[1] ?? currentBranch;

  if (!/^feat\/task-\d+/.test(branch)) {
    console.log(
      `Branch '${branch}' is not a task branch (feat/task-*). Skipping handoff auto-update.`
    );
    return;
  }

  const baseRemoteRef = `refs/remotes/${baseBranch}`;
  const baseLocalRef = `refs/heads/${baseBranch.replace(/^origin\//, "")}`;
  if (!refExists(baseRemoteRef) && !refExists(baseLocalRef)) {
    throw new Error(
      `Base branch '${baseBranch}' not found. Pass a valid base branch as the first argument.`
    );
  }

  const mergeBase = git(["merge-base", branch, baseBranch]);
  const mergeBaseShort = git(["rev-parse", "--short", mergeBase]);
  const headShort = git(["rev-parse", "--short", branch]);
  const taskMatch = branch.match(/^feat\/task-(\d+)(?:-(.+))?$/);
  const taskNumber = taskMatch ? taskMatch[1] : "unknown";
  const taskLabel = taskMatch?.[2] ? taskMatch[2].replace(/-/g, " ") : "task";
  const today = new Date().toISOString().slice(0, 10);

  const changedFilesOutput = git(["diff", "--name-only", `${mergeBase}..${branch}`], true);
  const changedFiles = changedFilesOutput
    ? changedFilesOutput.split("\n").map((file) => file.trim()).filter(Boolean)
    : [];
  const keyFiles = changedFiles
    .filter((file) => file !== AGENTS_PATH && file !== PROGRESS_PATH)
    .slice(0, 12);

  const agentsEntry = [
    `<!-- AUTO_HANDOFF_ENTRY:${branch}:start -->`,
    `- ${today} | task ${taskNumber} (${taskLabel}) | branch \`${branch}\` | base \`${baseBranch}\` (\`${mergeBaseShort}\`) | head \`${headShort}\` | changed files: ${changedFiles.length}`,
    `- key files: ${formatChangedFiles(keyFiles)}`,
    `<!-- AUTO_HANDOFF_ENTRY:${branch}:end -->`,
  ].join("\n");

  const progressEntry = [
    `<!-- AUTO_HANDOFF_ENTRY:${branch}:start -->`,
    `### Auto Handoff: Task ${taskNumber} (${today})`,
    `- Branch: \`${branch}\``,
    `- Base: \`${baseBranch}\` @ \`${mergeBaseShort}\``,
    `- Head: \`${headShort}\``,
    `- Task label: ${taskLabel}`,
    `- Changed files (${changedFiles.length}): ${formatChangedFiles(keyFiles)}`,
    `- Status note: Auto-generated handoff entry. Replace with final PR/CI/merge outcomes when task closes.`,
    `<!-- AUTO_HANDOFF_ENTRY:${branch}:end -->`,
  ].join("\n");

  writeUpdatedFile(AGENTS_PATH, branch, agentsEntry);
  writeUpdatedFile(PROGRESS_PATH, branch, progressEntry);

  console.log(
    `Updated handoff docs for '${branch}': ${AGENTS_PATH}, ${PROGRESS_PATH}`
  );
}

main();
