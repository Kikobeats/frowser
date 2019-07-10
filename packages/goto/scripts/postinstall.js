'use strict'

const { PuppeteerBlocker, getLinesWithFilters } = require('@cliqz/adblocker')
const debug = require('debug-logfmt')('browserless:goto:postinstall')
const { promisify } = require('util')
const split = require('binary-split')
const crypto = require('crypto')
const { EOL } = require('os')
const got = require('got')
const fs = require('fs')

const writeFile = promisify(fs.writeFile)

// uBlock Origin –  https://github.com/uBlockOrigin/uAssets/tree/master/filters
const RESOURCES =
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resources.txt'

const FILTERS = [
  // uBlock Origin –  https://github.com/uBlockOrigin/uAssets/tree/master/filters
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',

  // Fanboy – https://www.fanboy.co.nz
  // Easylist, Easyprivacy, Enhanced Trackers
  'https://www.fanboy.co.nz/r/fanboy-complete.txt',
  // Fanboy Annoyances List + Fanboy-Social List
  'https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt',
  // Other
  // Cookies Lists
  'https://www.fanboy.co.nz/fanboy-cookiemonster.txt',
  // crypto miners
  'https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/nocoin.txt'
]

const HOSTS = [
  // Steven Black hosts – https://github.com/StevenBlack/hosts
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
]

const OUTPUT_FILENAME = 'src/engine.bin'

const fetch = async url => (await got(url)).body

const fetchLists = async (urls, fn) => {
  const filterLists = await Promise.all(urls.map(fn))
  const set = filterLists.reduce((acc, set) => new Set([...acc, ...set]), new Set())
  debug(fn.type, { urls: urls.length, count: set.size })
  return Array.from(set)
}

const fetchFilterList = async url => {
  const entries = await fetch(url)
  const filters = getLinesWithFilters(entries)
  debug('filters', { url, count: filters.size })
  return filters
}

fetchFilterList.type = 'filters'

const fetchHostList = async url =>
  new Promise((resolve, reject) => {
    const hosts = []
    got
      .stream(url)
      .pipe(split())
      .on('error', reject)
      .on('finish', () => {
        debug('hosts', { url, count: hosts.length })
        return resolve(getLinesWithFilters(hosts.join(EOL)))
      })
      .on('data', data => {
        let line = data.toString()
        if (line.startsWith('0.0.0') && !line.startsWith('0.0.0.0 0.0.0.0')) {
          const [, hostname] = line.split(' ')
          line = `||${hostname}^`
        }
        hosts.push(line)
      })
  })

fetchHostList.type = 'hosts'

const main = async () => {
  // fetch all rules and merge it into an unique list of rules
  const [hosts, filters] = await Promise.all([
    fetchLists(HOSTS, fetchHostList),
    fetchLists(FILTERS, fetchFilterList)
  ])

  const rules = Array.from(new Set([...hosts, ...filters]))
  debug.info('total', {
    urls: HOSTS.length + FILTERS.length,
    count: rules.length
  })

  // create a ad-blocker engine
  const engine = PuppeteerBlocker.parse(rules.join(EOL))

  // save the engine to be used lately by the process
  const resources = await fetch(RESOURCES)
  const checksum = crypto
    .createHash('sha1')
    .update(resources, 'utf8')
    .digest('hex')

  engine.updateResources(resources, checksum)
  await writeFile(OUTPUT_FILENAME, engine.serialize())
}

main()
  .catch(err => console.error(err) && process.exit(1))
  .then(process.exit)
