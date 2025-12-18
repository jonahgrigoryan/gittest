#!/usr/bin/env node
/**
 * CI Feedback Loop Tool (GitHub API Version)
 * 
 * Uses GitHub REST API directly - no GitHub CLI required.
 * Requires GITHUB_TOKEN environment variable.
 * 
 * Usage:
 *   GITHUB_TOKEN=xxx pnpm tsx tools/ci-feedback-api.ts <owner>/<repo> <commit-sha> [--timeout=30]
 */

import { setTimeout } from 'timers/promises';

const [ownerRepo, COMMIT_SHA] = process.argv.slice(2);
const TIMEOUT_MINUTES = parseInt(process.argv.find(arg => arg.startsWith('--timeout='))?.split('=')[1] || '30', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!ownerRepo || !COMMIT_SHA) {
    console.error('Usage: GITHUB_TOKEN=xxx ci-feedback-api.ts <owner>/<repo> <commit-sha> [--timeout=30]');
    console.error('Example: GITHUB_TOKEN=xxx ci-feedback-api.ts owner/repo abc123');
    process.exit(1);
}

if (!GITHUB_TOKEN) {
    console.error('Error: GITHUB_TOKEN environment variable required');
    console.error('Create a token at: https://github.com/settings/tokens');
    console.error('Required scopes: repo (for private repos) or public_repo (for public repos)');
    process.exit(1);
}

const [owner, repo] = ownerRepo.split('/');
if (!owner || !repo) {
    console.error('Error: Invalid owner/repo format. Use: owner/repo');
    process.exit(1);
}

interface WorkflowRun {
    id: number;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'cancelled' | null;
    html_url: string;
    name: string;
    jobs_url: string;
}

async function fetchWorkflowRuns(commitSha: string): Promise<WorkflowRun[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${commitSha}&per_page=10`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.workflow_runs || [];
}

async function fetchJobLogs(jobsUrl: string): Promise<string> {
    const response = await fetch(jobsUrl, {
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!response.ok) {
        return `Failed to fetch job logs: ${response.status}`;
    }

    const data = await response.json();
    const jobs = data.jobs || [];

    let logs = '';
    for (const job of jobs) {
        if (job.conclusion === 'failure') {
            logs += `\n${'='.repeat(80)}\n`;
            logs += `Job: ${job.name} (${job.conclusion})\n`;
            logs += `URL: ${job.html_url}\n`;
            logs += `${'='.repeat(80)}\n`;

            // Fetch logs for each step
            for (const step of job.steps || []) {
                if (step.conclusion === 'failure') {
                    logs += `\nFailed Step: ${step.name}\n`;
                    // Note: Actual log content requires additional API call to download logs
                    // For now, we provide the URL
                    logs += `View logs at: ${job.html_url}\n`;
                }
            }
        }
    }

    return logs;
}

async function monitorCI(): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = TIMEOUT_MINUTES * 60 * 1000;
    const pollInterval = 15000; // 15 seconds

    console.log(`Monitoring CI for commit ${COMMIT_SHA} (timeout: ${TIMEOUT_MINUTES}min)`);
    console.log(`Repository: ${owner}/${repo}`);

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const runs = await fetchWorkflowRuns(COMMIT_SHA);

            if (runs.length === 0) {
                console.log('No workflow runs found yet, waiting...');
                await setTimeout(pollInterval);
                continue;
            }

            // Check if all runs are completed
            const allCompleted = runs.every(run => run.status === 'completed');
            const anyFailed = runs.some(run => run.status === 'completed' && run.conclusion === 'failure');
            const allSuccess = runs.every(run => run.status === 'completed' && run.conclusion === 'success');

            if (allCompleted && allSuccess) {
                console.log('\n✅ All CI checks passed!');
                console.log(`\nWorkflow runs:`);
                runs.forEach(run => {
                    console.log(`  - ${run.name}: ${run.html_url}`);
                });
                process.exit(0);
            }

            if (allCompleted && anyFailed) {
                console.error('\n❌ CI checks failed!');
                console.error(`\nFailed workflow runs:`);

                const failedRuns = runs.filter(run => run.conclusion === 'failure');
                for (const run of failedRuns) {
                    console.error(`\n${'='.repeat(80)}`);
                    console.error(`Failed: ${run.name}`);
                    console.error(`URL: ${run.html_url}`);
                    console.error(`${'='.repeat(80)}\n`);

                    const logs = await fetchJobLogs(run.jobs_url);
                    console.error(logs);
                }

                process.exit(1);
            }

            // Still running
            const inProgress = runs.filter(run => run.status !== 'completed');
            if (inProgress.length > 0) {
                console.log(`\n⏳ ${inProgress.length} workflow(s) still running:`);
                inProgress.forEach(run => {
                    console.log(`  - ${run.name}: ${run.status}`);
                });
            }

            await setTimeout(pollInterval);
        } catch (error) {
            console.error('Error monitoring CI:', error);
            await setTimeout(pollInterval);
        }
    }

    console.error(`\n⏱️  Timeout after ${TIMEOUT_MINUTES} minutes`);
    console.error('CI may still be running. Check manually:');
    console.error(`  https://github.com/${owner}/${repo}/actions`);
    process.exit(2);
}

monitorCI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

