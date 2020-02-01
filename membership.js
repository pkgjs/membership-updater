'use strict'
const got = require('got')
const diffparser = require('diffparser')
const { DateTime } = require('luxon')

module.exports = {
  processMembership,
  openMembershipRequests,
  processPR,
  getApprovals
}

const DEFAULTS = {
  label: 'membership-request',
  filename: 'README.md',
  requiredApprovals: 2,
  requiredOpenDays: 2
}

async function processMembership (client, options = {}) {
  // Default options
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const [members, pulls] = await Promise.all([
    // Get current team members
    getTeamMembers(client, opts),

    // Get open requests
    openMembershipRequests(client, {
      owner: opts.owner,
      repo: opts.repo
    })
  ])

  const pullsMerged = []
  for (const pull of pulls) {
    if (pull instanceof Error) {
      // @TODO review on PR with required changes
      continue
    }

    // Must be open for 48 hours and have 2 approvals
    const openTime = DateTime.local().minus({ days: opts.requiredOpenDays }).startOf('day')
    if (pull.created > openTime && pull.approvals < opts.requiredApprovals) {
      // wait for approvals or open time
      continue
    }

    // Not already a member, add them before merging
    if (!members.includes(pull.username)) {
      await addTeamMember(client, {
        ...opts,
        username: pull.username
      })
    }

    await mergePR(client, {
      ...opts,
      pullNumber: pull.pullNumber
    })

    pullsMerged.push(pull)
  }

  return pullsMerged
}

async function openMembershipRequests (client, options = {}) {
  // Default options
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const resp = await client.issues.listForRepo({
    owner: opts.owner,
    repo: opts.repo,
    state: 'open',
    labels: opts.label
  })

  return (await Promise.all(resp.data.map((issue) => {
    if (!issue.pull_request) {
      // Convert issue to PR?
      return
    }

    try {
      return processPR(client, issue, opts)
    } catch (e) {
      return e
    }
  }))).filter((p) => p !== undefined)
}

async function processPR (client, pull, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  // Get diff should contain only file with a single change
  const diffResp = await got(pull.pull_request.diff_url)
  const diff = diffparser(diffResp.body)

  // Should only have one changed file
  if (diff.length > 1) {
    throw new Error(`Too many changed files: ${diff.length}`)
  }

  for (const file of diff) {
    // no moving file
    if (file.from !== file.to) {
      throw new Error(`No moving files: ${file.from} ${file.to}`)
    }

    // wrong file
    if (file.to !== opts.filename) {
      throw new Error(`Wrong file changed: ${file.to}`)
    }

    // If there are multiple chunks that means a change to multiple
    // parts of the file, it should just be one line
    if (file.chunks.length > 1) {
      throw new Error(`Too many changes: ${file.chunks.length}`)
    }

    // Find line which is a single line addition
    // error on deletions of improperly formated changes
    let match
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'normal') {
          continue
        }
        if (change.type === 'del') {
          throw new Error(`Cannot remove lines: ${change.content}`)
        }

        // Check format
        match = change.content.match(/^\+- \[@(.+)\]\(https:\/\/github\.com\/(.+)\) - (.+)$/)
        if (!match) {
          throw new Error(`Invalid format: ${change.content}`)
        }
        if (match[1] !== match[2]) {
          throw new Error(`Username should match github url: ${match[1]} !== ${match[2]}`)
        }
        if (match[1] !== pull.user.login) {
          throw new Error(`Username should match author of PR: ${match[1]} !== ${pull.user.login}`)
        }
      }
    }

    return {
      number: pull.number,
      title: pull.title,
      username: match[1],
      displayName: match[3],
      body: pull.body,
      approvals: await getApprovals(client, pull.number, opts),
      authorAssociation: pull.author_association,
      created: DateTime.fromISO(pull.created_at)
    }
  }
}

async function getApprovals (client, pullNumber, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  // Get reviewer data
  const reviewsResp = await client.pulls.listReviews({
    owner: opts.owner,
    repo: opts.repo,
    pull_number: pullNumber
  })

  let approvals = 0
  for (const review of reviewsResp.data) {
    // Only care about member reviews
    if (review.author_association !== 'MEMBER') {
      continue
    }

    // Error if pending review changes
    if (review.state === 'REQUEST_CHANGES') {
      throw new Error(`Request for changes: ${review.body}`)
    }

    ++approvals
  }
  return approvals
}

async function getTeamMembers (client, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  try {
    const resp = await client.teams.listMembersInOrg({
      org: opts.owner,
      team_slug: opts.team
    })
    return resp.data.map((u) => {
      return u.login
    })
  } catch (e) {
    console.log(e)
    throw new Error('Failed to get team members')
  }
}

async function addTeamMember (client, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const resp = await client.teams.addOrUpdateMembershipInOrg({
    org: opts.owner,
    team_slug: opts.team,
    username: opts.username
  })
  return resp.data
}

async function mergePR (client, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const resp = await client.pulls.merge({
    org: opts.owner,
    team_slug: opts.team,
    pull_number: opts.pullNumber,
    merge_method: 'rebase'
  })
  return resp.data
}
