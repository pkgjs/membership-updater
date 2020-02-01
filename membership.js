'use strict'
const got = require('got')
const fs = require('fs-extra')
const execa = require('execa')
const diffparser = require('diffparser')
const { DateTime } = require('luxon')

module.exports = {
  processMembershipRequests,
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

async function processMembershipRequests (client, options = {}) {
  // Default options
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const [members, pulls] = await Promise.all([
    // Get current team members
    getTeamMembers(client, opts),

    // Get open requests
    openMembershipRequests(client, opts)
  ])

  // Merge open pull requests
  const pullsMerged = []
  for (const pull of pulls) {
    if (pull instanceof Error) {
      // @TODO review on PR with required changes
      console.error(pull)
      continue
    }

    // Must be open for 48 hours and have 2 approvals
    const openTime = DateTime.local().minus({ days: opts.requiredOpenDays }).startOf('day')
    if (pull.created > openTime && pull.approvals < opts.requiredApprovals) {
      // wait for approvals or open time
      console.error(`Skipping ${pull.number}. ${pull.approvals} approvals. ${DateTime.local().diff(pull.created, 'days')}`)
      continue
    }

    // Not already a member, add them before merging
    if (!members.find(({ login }) => login === pull.username)) {
      await addTeamMember(client, {
        ...opts,
        username: pull.username
      })
    }

    await mergePR(client, {
      ...opts,
      pullNumber: pull.number
    })

    pullsMerged.push(pull)
  }

  // Sync to the members file
  await syncList(members, opts)

  return {
    members,
    pullsMerged
  }
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

  return (await Promise.all(resp.data.map(async (issue) => {
    if (!issue.pull_request) {
      // Convert issue to PR?
      return
    }

    try {
      const pull = await processPR(client, issue, opts)
      return pull
    } catch (e) {
      // Return error for logging
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
  const diffResp = await got(pull.diff_url || pull.pull_request.diff_url)
  const diff = diffparser(diffResp.body)

  // Should only have one changed file
  if (diff.length > 1) {
    throw new Error(`Too many changed files: ${diff.length}`)
  }

  let match
  for (const file of diff) {
    // no moving file
    if (file.from !== file.to) {
      throw new Error(`No moving files: ${file.from} ${file.to}`)
    }

    // wrong file
    if (file.to !== opts.filename) {
      throw new Error(`Wrong file changed: ${file.to}, expected ${opts.filename}`)
    }

    // If there are multiple chunks that means a change to multiple
    // parts of the file, it should just be one line
    if (file.chunks.length > 1) {
      throw new Error(`Too many changes: ${file.chunks.length}`)
    }

    // Find line which is a single line addition
    // error on deletions of improperly formated changes
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'normal') {
          continue
        }
        if (change.type === 'del') {
          throw new Error(`Do not remove lines: ${change.content}`)
        }

        // If we have already matched a line error with too many lines changed
        if (match && change.type === 'add') {
          throw new Error('Too many lines added, only add one name at a time.')
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
    return Promise.all(resp.data.sort((a, b) => {
      return a.login > b.login ? 1 : -1
    }).map(async (u) => {
      const resp = await client.users.getByUsername({
        username: u.login
      })
      return {
        login: resp.data.login,
        name: resp.data.name,
        url: resp.data.html_url
      }
    }))
  } catch (e) {
    throw new Error(`Failed to get team members: ${e.message}`)
  }
}

async function addTeamMember (client, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  try {
    const resp = await client.teams.addOrUpdateMembershipInOrg({
      org: opts.owner,
      team_slug: opts.team,
      username: opts.username
    })
    return resp.data
  } catch (e) {
    throw new Error(`Failed to add team member: ${e.message}`)
  }
}

async function mergePR (client, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  try {
    const resp = await client.pulls.merge({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.pullNumber,
      merge_method: 'rebase'
    })
    return resp.data
  } catch (e) {
    throw new Error(`Failed to merge PR: ${e.message}`)
  }
}

async function syncList (members, options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options
  }

  const prefix = `<!-- pkgjs-team-start(${opts.team}) -->`
  const suffix = `<!-- pkgjs-team-end(${opts.team}) -->`
  const sectionRe = new RegExp(`${escape(prefix)}[\\s\\S]+?${escape(suffix)}`, 'mg')

  // File to replace in
  let membersFile = await fs.readFile(opts.filename, 'utf8')

  // Members list
  let list = members.reduce((str, member) => {
    str += '\n' + getContact(member)
    return str
  }, '')
  list = `${prefix}\n${list}\n\n${suffix}`

  membersFile = membersFile.replace(sectionRe, list)
  await fs.writeFile(opts.filename, membersFile)

  // await execa('git', ['add', opts.filename])
  // await execa('git', ['commit', '--message', `chore (members): sync ${opts.team}`])
  // await execa('git', ['push', 'origin', 'master'])
}

function getContact ({ login, url, name }) {
  if (!name) return `- [@${login}](${url})`
  return `- [@${login}](${url}) - ${name}`
}

function escape (str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
