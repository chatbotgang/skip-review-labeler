# Skip Review Labeler

AI-powered GitHub Action that automatically labels low-risk pull requests for skipping human code review.

## Features

- **AI-Powered Analysis** - Uses OpenAI (or compatible APIs) to analyze PR changes
- **Conservative by Default** - Only labels PRs with high confidence scores
- **Transparent Decisions** - Adds explanatory comments to labeled PRs
- **Configurable** - Customize model, threshold, label name, and more
- **Four Categories** - Detects typo fixes, i18n updates, UI style changes, and code formatting

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PR Opened/    │────▶│  Fetch Diff &   │────▶│  AI Analyzes    │
│   Synchronized  │     │  File Changes   │     │  Changes        │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌─────────────────┐              │
                        │  Add Label &    │◀─── Yes ─────┤ Eligible &
                        │  Comment        │              │ High Confidence?
                        └─────────────────┘              │
                                                         │
                        ┌─────────────────┐              │
                        │  Skip (No       │◀─── No ──────┘
                        │  Action)        │
                        └─────────────────┘
```

## Quick Start

### 1. Add OpenAI API Key

Add your OpenAI API key as a repository secret:

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Name: `OPENAI_API_KEY`
4. Value: Your OpenAI API key

### 2. Create Workflow File

Create `.github/workflows/skip-review-labeler.yml`:

```yaml
name: AI Skip-Review Labeler

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  analyze:
    runs-on: ubuntu-latest
    # Skip if already labeled
    if: "!contains(github.event.pull_request.labels.*.name, 'skip-review')"

    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - uses: your-org/skip-review-labeler@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

## Configuration

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github_token` | GitHub token for API access | Yes | - |
| `openai_api_key` | OpenAI API key (or compatible) | Yes | - |
| `model` | AI model to use | No | `gpt-4o-mini` |
| `confidence_threshold` | Minimum confidence to apply label (0-100) | No | `80` |
| `label_name` | Label to apply when eligible | No | `skip-review` |
| `max_diff_size` | Maximum diff size in characters | No | `50000` |
| `add_comment` | Add explanatory comment to PR | No | `true` |

### Example with All Options

```yaml
- uses: your-org/skip-review-labeler@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
    model: gpt-4o
    confidence_threshold: 90
    label_name: auto-merge-eligible
    max_diff_size: 100000
    add_comment: true
```

## Skip-Review Categories

The action identifies four types of low-risk changes:

### 1. Fix Typos

Spelling or grammar corrections in comments, documentation, or string literals that don't affect functionality.

```diff
- // Calcualte the total price
+ // Calculate the total price
```

### 2. Update i18n Key

Changes to internationalization files, translation strings, or translation key references.

```diff
- "campaigns.title": "Campaigns"
+ "campaigns.title": "Marketing Campaigns"
```

### 3. Update UI Style

Visual-only changes to CSS, styled-components, or inline styles without logic changes.

```diff
- padding: 12px 16px;
+ padding: 16px 24px;
```

### 4. Code Formatting

Automated formatting changes from tools like Prettier or ESLint.

```diff
- const sum=a+b;
+ const sum = a + b;
```

## Outputs

| Output | Description |
|--------|-------------|
| `eligible` | Whether the PR is eligible for skip-review (`true`/`false`) |
| `confidence` | AI confidence score (0-100) |
| `category` | Detected category or `none` |

### Using Outputs

```yaml
- uses: your-org/skip-review-labeler@v1
  id: labeler
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}

- name: Check result
  run: |
    echo "Eligible: ${{ steps.labeler.outputs.eligible }}"
    echo "Confidence: ${{ steps.labeler.outputs.confidence }}%"
    echo "Category: ${{ steps.labeler.outputs.category }}"
```

## Security Considerations

- **Never commit API keys** - Always use repository secrets
- **Review the label** - The `skip-review` label is a suggestion, not a mandate
- **Conservative defaults** - 80% confidence threshold ensures high accuracy
- **Audit trail** - Comments explain why each PR was labeled
- **Human override** - Remove the label manually if you disagree

### What is NOT Eligible

The AI is trained to reject these change types:

- Any logic or functional changes
- API endpoint modifications
- Configuration file changes
- Dependency updates
- Test file changes
- Security-related code
- Database queries or migrations

## Troubleshooting

### 403 Permission Error

Ensure your workflow has the required permissions:

```yaml
permissions:
  contents: read
  pull-requests: write
```

### Label Not Applied

Check the workflow run logs. Common reasons:

1. **Confidence too low** - The AI wasn't confident enough (below threshold)
2. **Not eligible** - Changes include logic modifications
3. **Already labeled** - PR already has the skip-review label
4. **Diff too large** - Exceeds `max_diff_size`

### API Rate Limits

If hitting OpenAI rate limits:

1. Use a model with higher rate limits
2. Add concurrency controls to your workflow
3. Consider using Azure OpenAI endpoint

## Using with Azure OpenAI

The action supports Azure OpenAI by configuring the API endpoint:

```yaml
- uses: your-org/skip-review-labeler@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    openai_api_key: ${{ secrets.AZURE_OPENAI_KEY }}
    openai_base_url: https://your-resource.openai.azure.com
    model: your-deployment-name
```

## Cost Estimation

Using `gpt-4o-mini` (default):

- Average PR diff: ~2,000 tokens input, ~200 tokens output
- Cost per PR: ~$0.0003
- 1,000 PRs: ~$0.30

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.
