'use strict'
require('dotenv').config()
const { suite, test, before } = require('mocha')
const assert = require('assert')
const github = require('@actions/github')
const pkg = require('../package.json')
const { processMembership } = require('../membership')

suite(pkg.name, () => {
  let client
  before(() => {
    client = new github.GitHub(process.env.TEAM_MAINTAINER_TOKEN || process.env.GITHUB_TOKEN)
  })

  test('membership', async () => {
    const pullsMerged = await processMembership(client, {
      owner: 'pkgjs',
      repo: 'membership-updater',
      team: 'membership-updater-test-team',
      filename: 'MEMBERS.md'
    })
    assert(pullsMerged)
  })
})
