'use strict'
const core = require('@actions/core')
const github = require('@actions/github')
const membership = require('./membership')

;(async function () {
  try {
    const repo = github.context.repo
    const team = core.getInput('team', { required: true })
    const label = core.getInput('label', { required: true })
    const filename = core.getInput('filename', { required: true })
    // const artifact = core.getInput('artifact')

    switch (github.context.eventName) {
      case 'schedule':
        await onSchedule(process.env.TEAM_MAINTAINER_TOKEN, {
          ...repo,
          team,
          label,
          filename
        })
        break
      case 'pull_request':
        await onPullRequest(process.env.GITHUB_TOKEN, {
          ...repo,
          number: github.context.payload.number,
          team,
          label,
          filename
        })
        // @TODO track user activity
        break
      case 'push':
      case 'issues':
      case 'issue_comment':
        // @TODO track user activity
        break
    }
  } catch (err) {
    console.log(err)
    core.setFailed(err.message)
  }
})()

async function onSchedule (token, opts) {
  const client = new github.GitHub(token)
  const { pullsMerged } = await membership.processMembershipRequests(client, {
    owner: opts.owner,
    repo: opts.repo,
    team: opts.team
  })
  if (pullsMerged.length) {
    console.log(`PRs Merged:
- ${pullsMerged.map((p) => `#${p.number}: ${p.title}`).join('\n- ')}`)
  } else {
    console.log('No PRs merged')
  }
}

// Validate membership PRs data
async function onPullRequest (token, opts) {
  const client = new github.GitHub(token)
  const { data: pull } = await client.pulls.get({
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.number
  })

  // If no matching label, skip
  if (!pull.labels.find((l) => l.name === opts.label)) {
    return
  }

  return membership.processPR(client, pull, opts)
}
