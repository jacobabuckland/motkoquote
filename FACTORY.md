# Factory Deployment and Health Check Procedures

## Overview

The factory deployment pipeline includes a post-deploy health check that gates promotion to production. This ensures that deployments are verified against critical paths before reaching users.

## Health Check System

### How It Works

After a successful preview deployment:

1. **Warm-up phase**: The health check makes initial requests to all critical paths to handle cold starts
2. **Wait period**: A 10-second stabilization period allows serverless functions to fully initialize
3. **Verification phase**: Each critical path is checked with actual success criteria
4. **Gate**: Production promotion only proceeds if all checks pass

### Critical Paths Configuration

Critical paths are defined in `deploy-health-check.json` at the repository root. The configuration includes:

- Dashboard page (authenticated)
- Customer-facing quote page (public)
- TrueLayer webhook endpoint (payment processing)

To add a new critical path, edit `deploy-health-check.json` and add an entry with:
- `path`: The URL path to check
- `requiresAuth`: Whether the path requires authentication
- `description`: Human-readable description of what this path does

### Required Secrets

The health check requires the following GitHub repository secrets:

- `HEALTH_CHECK_TEST_EMAIL`: Email for the test account used to verify authenticated paths
- `HEALTH_CHECK_TEST_PASSWORD`: Password for the test account

**Important**: The test account must:
- Be a valid user account in the production database
- Have read-only or minimal permissions (cannot modify production data)
- Not be used for any other purpose

To set these secrets:
1. Go to repository Settings → Secrets and variables → Actions
2. Add or update the secrets with the test account credentials

### Cold Start Handling

Vercel serverless functions may be slow on first request due to cold starts. The health check handles this by:

1. Making a warm-up request to each path that is not counted toward pass/fail
2. Waiting 10 seconds after warm-up before running the actual check
3. Allowing up to 30 seconds per request with 2 automatic retries

If a check still fails after warm-up, it is treated as a genuine failure.

## Rollback Procedures

### Automatic Rollback (Failed Health Check)

When a health check fails:

1. The deployment is **not** promoted to production
2. The previous (working) deployment continues serving production traffic
3. An alert is posted as a comment on the factory issue and PR
4. No user-visible impact — users continue to see the last healthy version

### Manual Rollback (After Promotion)

If a problem is discovered after promotion, you can manually rollback to a previous deployment:

#### Via Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Login to Vercel
vercel login

# List recent deployments
vercel ls motkoquote

# Promote a specific deployment to production
vercel alias set <deployment-url> motko.app
```

#### Via Vercel Dashboard

1. Go to https://vercel.com/jacobabuckland/motkoquote
2. Navigate to the Deployments tab
3. Find the last known-good deployment
4. Click the three-dot menu → "Promote to Production"
5. Confirm the promotion

#### Via GitHub

If you need to roll back to a specific commit:

```bash
# Create a revert commit
git revert <bad-commit-sha>

# Or reset to a previous commit (use with caution)
git reset --hard <good-commit-sha>
git push origin main --force
```

**Important**: Force-pushing to main should be a last resort. Prefer creating revert commits.

## Manual Override and Emergency Deploy

### When to Use Manual Override

Use manual override when:

- The health check is failing due to a misconfiguration in the check itself
- An urgent fix must be deployed despite a non-critical health check failure
- The health check is experiencing a temporary outage

**Do not** use override to bypass legitimate failures. If critical paths are broken, fix the code, not the gate.

### Override Procedure

The override procedure requires **explicit action** and is **automatically logged**:

1. Navigate to the GitHub Actions tab
2. Select "Deploy Health Check" workflow
3. Click "Run workflow"
4. Select the branch: `main`
5. Fill in the required inputs:
   - `deployment_url`: The preview URL to promote (without health check)
   - `issue_number`: The factory issue number
   - `pr_number`: The PR number
6. Add a comment to the issue explaining why the override was necessary
7. Click "Run workflow"

All manual workflow runs are logged in GitHub Actions with:
- Who triggered the run
- When it was triggered
- What deployment was promoted
- The workflow run ID for audit trail

### Override via Vercel Direct Promotion

For emergency situations where the health check workflow itself is broken:

1. Use the Vercel manual rollback procedure above to promote a deployment directly
2. **Immediately** post a comment on the relevant factory issue explaining:
   - What was promoted
   - Why the override was necessary
   - Who authorized it
   - What follow-up actions are needed

This ensures there is an audit trail even when GitHub Actions is bypassed.

### No Silent Bypass

There is no way to accidentally bypass the health check:

- Normal merge-to-main does not trigger automatic promotion (health check gates it)
- Manual promotion requires explicit workflow dispatch or Vercel dashboard action
- All promotion actions are logged to GitHub Actions or Vercel deployment logs
- Failed health checks post visible comments on issues and PRs

## Deployment Flow

### Normal Flow (Healthy Deployment)

1. Code is merged to a factory branch
2. PR is created and marked ready for review
3. Vercel deploys to a preview URL
4. Factory deploy workflow waits for preview and posts URL
5. Reviewer approves and merges PR to main
6. Vercel deploys main branch to a new preview URL
7. **Health check workflow runs against the main branch preview**
8. **If health check passes**: Deployment is promoted to production alias (motko.app)
9. Factory ship workflow marks the issue as shipped

### Failed Health Check Flow

1. Steps 1-6 same as above
2. **Health check workflow runs and fails**
3. **Deployment is not promoted** — production continues serving previous version
4. Alert is posted to issue and PR
5. Engineer investigates failure
6. Either:
   - Fix the code issue and push a new commit (restart flow)
   - Fix the health check configuration if it was a false positive
   - Use manual override if justified (documented above)

## Troubleshooting

### Health Check Failures

**All paths failing**:
- Verify the deployment URL is correct and accessible
- Check Vercel deployment logs for runtime errors
- Confirm the deployment built successfully

**Authenticated path failing**:
- Verify `HEALTH_CHECK_TEST_EMAIL` and `HEALTH_CHECK_TEST_PASSWORD` secrets are set
- Confirm the test account exists and credentials are correct
- Check that authentication is working in the deployment

**TrueLayer webhook failing**:
- Webhook endpoints often require specific headers or request methods
- Review the endpoint implementation for breaking changes
- Check Vercel function logs for errors

**Intermittent failures**:
- May be due to cold starts not fully warming up
- Consider increasing the warm-up wait time in the health check script
- Check for rate limiting or external service issues

### Concurrency Issues

The health check workflow uses `concurrency: production-promotion` to ensure only one promotion runs at a time. If you see "Workflow is waiting for a concurrency group", it means another deployment is being checked or promoted. Wait for it to complete.

## Monitoring and Alerts

### Where to Check Status

- **GitHub Actions**: See all health check runs at https://github.com/jacobabuckland/motkoquote/actions/workflows/deploy-health-check.yml
- **Issue comments**: Failed checks post alerts to the factory issue
- **PR comments**: Failed checks post alerts to the PR
- **Vercel dashboard**: See deployment and alias status at https://vercel.com/jacobabuckland/motkoquote

### What Gets Alerted

The health check posts alerts for:
- ❌ Health check failures (with link to workflow run)
- ✅ Health check successes (deployment ready for promotion)
- Override actions (logged in workflow runs and should be commented on issues)

## Schema Changes and Migrations

**Important**: Database migrations must be applied **before** code is merged to main.

The health check runs against the preview deployment, which shares the same database as production. If code expects a schema change that hasn't been applied yet:

1. The health check will fail (code expects columns/tables that don't exist)
2. This prevents the broken deployment from reaching production
3. Apply the migration with `supabase db push` first
4. Retry the deployment (health check will now pass)

This is the same process as before — the health check just makes the failure explicit and prevents promotion, rather than breaking production.

## Testing the Health Check

To test changes to the health check configuration or script without deploying:

```bash
# Run the health check script locally against a preview deployment
DEPLOYMENT_URL="https://preview-url.vercel.app" \
  .github/scripts/health-check.sh

# Test against production (read-only check, won't affect anything)
DEPLOYMENT_URL="https://motko.app" \
  .github/scripts/health-check.sh
```

Note: Authenticated checks will fail locally unless you export the test account credentials:

```bash
export TEST_ACCOUNT_EMAIL="test@example.com"
export TEST_ACCOUNT_PASSWORD="password"
DEPLOYMENT_URL="https://preview-url.vercel.app" \
  .github/scripts/health-check.sh
```

## Future Enhancements

Out of scope for the initial implementation but potential future improvements:

- Staged rollout or canary deployments (percentage-based traffic splitting)
- Ongoing synthetic monitoring (this currently only runs at deploy time)
- Health check endpoint in the application itself (`/api/health`)
- Distinction between critical failures (block) and warnings (alert but allow)
- Pin native shell to specific build version for emergency rollback
