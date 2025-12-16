#!/usr/bin/env node
/**
 * CI Feedback Loop Tool
 * 
 * Monitors GitHub Actions CI runs after a push and returns:
 * - Success: exits 0 with success message
 * - Failure: exits 1 with error logs for agent to fix
 * 
 * Usage:
 *   pnpm tsx tools/ci-feedback.ts <commit-sha> [--timeout=30]
 */

import { execSync } from 'child_process';
import { setTimeout } from 'timers/promises';

const COMMIT_SHA = process.argv[2];
const TIMEOUT_MINUTES = parseInt(process.argv.find(arg => arg.startsWith('--timeout='))?.split('=')[1] || '30', 10);

if (!COMMIT_SHA) {
    console.error('Usage: ci-feedback.ts <commit-sha> [--timeout=30]');
    process.exit(1);
}

interface WorkflowRun {
    id: number;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'cancelled' | null;
    html_url: string;
    name: string;
}

async function getLatestRuns(commitSha: string): Promise<WorkflowRun[]> {
    try {
        const output = execSync(
            `gh run list --commit ${commitSha} --json id,status,conclusion,html_url,name --limit 10`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        return JSON.parse(output);
    } catch (error) {
        console.error('Failed to fetch workflow runs:', error);
        return [];
    }
}

async function getRunLogs(runId: number): Promise<string> {
    try {
        return execSync(
            `gh run view ${runId} --log`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
    } catch (error) {
        return `Failed to fetch logs: ${error}`;
    }
}

async function monitorCI(): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = TIMEOUT_MINUTES * 60 * 1000;
    const pollInterval = 15000; // 15 seconds

    console.log(`Monitoring CI for commit ${COMMIT_SHA} (timeout: ${TIMEOUT_MINUTES}min)`);

    while (Date.now() - startTime < maxWaitMs) {
        const runs = await getLatestRuns(COMMIT_SHA);

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

                const logs = await getRunLogs(run.id);
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
    }

    console.error(`\n⏱️  Timeout after ${TIMEOUT_MINUTES} minutes`);
    console.error('CI may still be running. Check manually:');
    console.error(`  gh run list --commit ${COMMIT_SHA}`);
    process.exit(2);
}

monitorCI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

