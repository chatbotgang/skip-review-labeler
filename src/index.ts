/**
 * Skip Review Labeler - AI-Powered PR Analysis
 *
 * This script analyzes GitHub pull request changes and determines if they qualify
 * for skipping human code review based on `analysis-prompt.md` instructions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from '@octokit/rest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration from environment variables
 */
interface Config {
  model: string;
  confidenceThreshold: number;
  labelName: string;
  maxDiffSize: number;
  addComment: boolean;
  openaiBaseUrl: string;
}

function getConfig(): Config {
  return {
    model: process.env.INPUT_MODEL || 'gpt-5-mini',
    confidenceThreshold: parseInt(process.env.INPUT_CONFIDENCE_THRESHOLD || '80', 10),
    labelName: process.env.INPUT_LABEL_NAME || 'skip-review',
    maxDiffSize: parseInt(process.env.INPUT_MAX_DIFF_SIZE || '50000', 10),
    addComment: process.env.INPUT_ADD_COMMENT !== 'false',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  };
}

/**
 * Types
 */
interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface DiffData {
  diffContent: string;
  fileCount: number;
  additions: number;
  deletions: number;
  files: FileInfo[];
}

interface Analysis {
  eligible: boolean;
  category: string | string[];
  confidence: number;
  reasoning: string;
  flags?: string[];
}

interface GitHubContext {
  event?: {
    pull_request?: {
      number: number;
    };
  };
  repository?: string;
}

/**
 * Fetch PR diff from GitHub
 */
async function fetchPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  config: Config
): Promise<DiffData> {
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const prFiles = files as PullRequestFile[];

  let diffContent = `# Pull Request #${prNumber} - File Changes\n\n`;
  diffContent += `Total files changed: ${prFiles.length}\n\n`;

  for (const file of prFiles) {
    diffContent += `## File: ${file.filename}\n`;
    diffContent += `Status: ${file.status}\n`;
    diffContent += `Additions: +${file.additions} | Deletions: -${file.deletions}\n\n`;

    if (file.patch) {
      diffContent += '```diff\n';
      diffContent += file.patch;
      diffContent += '\n```\n\n';
    } else {
      diffContent += '(No patch available - likely binary or very large file)\n\n';
    }
  }

  if (diffContent.length > config.maxDiffSize) {
    diffContent = diffContent.substring(0, config.maxDiffSize);
    diffContent += '\n\n... (diff truncated due to size) ...\n';
  }

  return {
    diffContent,
    fileCount: prFiles.length,
    additions: prFiles.reduce((sum, f) => sum + f.additions, 0),
    deletions: prFiles.reduce((sum, f) => sum + f.deletions, 0),
    files: prFiles.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}

/**
 * Load AI prompt from file
 */
function loadAIPrompt(): string {
  const promptPath = path.join(__dirname, '..', 'prompts', 'analysis-prompt.md');
  return fs.readFileSync(promptPath, 'utf8');
}

/**
 * Analyze PR with AI
 */
async function analyzeWithAI(diffData: DiffData, config: Config): Promise<Analysis> {
  const systemPrompt = loadAIPrompt();
  const userPrompt = `Analyze the following pull request changes and determine if they qualify for skip-review:

${diffData.diffContent}

Provide your analysis in the specified JSON format.`;

  const apiUrl = `${config.openaiBaseUrl}/chat/completions`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const aiResponse = data.choices[0].message.content;
  const analysis = JSON.parse(aiResponse) as Analysis;

  const isValidCategory =
    typeof analysis.category === 'string' ||
    (Array.isArray(analysis.category) && analysis.category.every((item) => typeof item === 'string') && analysis.category.length > 0);

  if (
    typeof analysis.eligible !== 'boolean' ||
    typeof analysis.confidence !== 'number' ||
    !analysis.reasoning ||
    !isValidCategory
  ) {
    throw new Error('Invalid AI response format');
  }

  return analysis;
}

/**
 * Apply skip-review label to PR
 */
async function applySkipReviewLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  analysis: Analysis,
  config: Config
): Promise<void> {
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [config.labelName],
  });

  console.log(`Applied '${config.labelName}' label to PR #${prNumber}`);

  if (config.addComment) {
    const commentBody = `**AI Skip-Review Analysis**

**Category**: ${formatCategory(analysis.category)}
**Confidence**: ${analysis.confidence}%

**Reasoning**: ${analysis.reasoning}

This PR has been automatically labeled as \`${config.labelName}\` based on AI analysis. The changes appear to be low-risk and do not require human code review.

${analysis.flags && analysis.flags.length > 0 ? `\n**Notes**: ${analysis.flags.join(', ')}` : ''}

---
*If you believe this categorization is incorrect, please remove the label and request review.*`;

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });

    console.log('Added explanatory comment to PR');
  }
}

/**
 * Set GitHub Action output
 */
function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function formatCategory(category: string | string[]): string {
  return Array.isArray(category) ? category.join(', ') : category;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const config = getConfig();

    // Validate required environment variables
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN is required');
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }

    // Get GitHub context
    const context: GitHubContext = JSON.parse(process.env.GITHUB_CONTEXT || '{}');
    const prNumber = context.event?.pull_request?.number;
    const repository = context.repository;

    if (!prNumber || !repository) {
      throw new Error('Unable to determine PR number or repository from context');
    }

    const [owner, repo] = repository.split('/');

    console.log(`Analyzing PR #${prNumber} in ${owner}/${repo}`);

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Step 1: Fetch PR diff
    console.log('Fetching PR diff...');
    const diffData = await fetchPRDiff(octokit, owner, repo, prNumber, config);
    console.log(
      `PR stats: ${diffData.fileCount} files, +${diffData.additions}/-${diffData.deletions} lines`
    );

    // Step 2: Analyze with AI
    console.log('Analyzing with AI...');
    const analysis = await analyzeWithAI(diffData, config);

    console.log('\nAI Analysis Results:');
    console.log(`  Eligible: ${analysis.eligible}`);
    console.log(`  Category: ${formatCategory(analysis.category)}`);
    console.log(`  Confidence: ${analysis.confidence}%`);
    console.log(`  Reasoning: ${analysis.reasoning}`);

    // Set outputs
    setOutput('eligible', String(analysis.eligible));
    setOutput('confidence', String(analysis.confidence));
    setOutput('category', formatCategory(analysis.category));
    setOutput('reasoning', analysis.reasoning);

    // Step 3: Apply label if eligible and confidence is high enough
    if (analysis.eligible && analysis.confidence >= config.confidenceThreshold) {
      console.log(
        `\nPR qualifies for skip-review (confidence: ${analysis.confidence}% >= ${config.confidenceThreshold}%)`
      );
      await applySkipReviewLabel(octokit, owner, repo, prNumber, analysis, config);
    } else if (analysis.eligible && analysis.confidence < config.confidenceThreshold) {
      console.log(
        `\nPR is eligible but confidence too low (${analysis.confidence}% < ${config.confidenceThreshold}%)`
      );
    } else {
      console.log(`\nPR does not qualify for skip-review`);
      console.log(`  Reason: ${analysis.reasoning}`);
      if (analysis.flags && analysis.flags.length > 0) {
        console.log(`  Flags: ${analysis.flags.join(', ')}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(`\nError: ${(error as Error).message}`);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

main();

export { analyzeWithAI, fetchPRDiff, applySkipReviewLabel };
