# @pkgjs/membership-updater

[![NPM Version](https://img.shields.io/npm/v/@pkgjs/membership-updater.svg)](https://npmjs.org/package/@pkgjs/membership-updater)
[![NPM Downloads](https://img.shields.io/npm/dm/@pkgjs/membership-updater.svg)](https://npmjs.org/package/@pkgjs/membership-updater)
[![Build Status](https://travis-ci.org/wesleytodd/@pkgjs/membership-updater.svg?branch=master)](https://travis-ci.org/wesleytodd/@pkgjs/membership-updater)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](https://github.com/standard/standard)

A GitHub action to manage group membership

This repository is managed by the [Package Maintenance Working Group](https://github.com/nodejs/package-maintenance), see [Governance](https://github.com/nodejs/package-maintenance/blob/master/Governance.md).

## Inputs

### Required

#### github-token

Secret GitHub token

#### team-maintainer-token

TBD

#### team

TBD

### Optional

#### artifact

Artifact path to save

_Default:_ `membership.json`

#### label

The label to use for membership requests

_Default:_ `membership-request`

#### filename

The file in which the membership list lives

_Default:_ `README.md`

## Outputs

_n/a_

