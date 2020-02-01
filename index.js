'use strict'
const core = require('@actions/core')
const github = require('@actions/github')
const membership = require('./membership')

;(async function () {
  try {
    const team = core.getInput('team', { required: true })
    // const artifact = core.getInput('artifact')

    console.log(github.context.eventName)
    switch (github.context.eventName) {
      case 'schedule':
        await onSchedule(process.env.TEAM_MAINTAINER_TOKEN, github.context.repo, team)
        break
      case 'push':
      case 'issues':
      case 'issue_comment':
      case 'pull_request':
        // @TODO track user activity
        break
    }
  } catch (err) {
    console.log(err)
    core.error(err)
    core.setFailed(err.message)
  }
})()

async function onSchedule (token, repo, team) {
  const client = new github.GitHub(process.env.TEAM_MAINTAINER_TOKEN)
  const updatedPulls = await membership.processMembership(client, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    team: team
  })
  console.log(updatedPulls)
  return updatedPulls
}
