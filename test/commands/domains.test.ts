import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runCommand} from '@oclif/test'
import {expect} from 'chai'

import {saveConfig} from '../../src/lib/config.js'

function cloudflareResponse(result: unknown) {
  return {errors: [], messages: [], result, 'result_info': {page: 1, 'total_pages': 1}, success: true}
}

function jsonResponse(body: unknown): Response {
  return {json: async () => body, ok: true, status: 200} as Response
}

describe('domains', () => {
  const originalFetch = globalThis.fetch
  const env = {...process.env}
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doomain-domains-'))
    process.env = {...env, CLOUDFLARE_ACCOUNT_ID: 'account_123', CLOUDFLARE_API_TOKEN: 'token', DOOMAIN_CONFIG_FILE: join(dir, 'config.json')}
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env = {...env}
    rmSync(dir, {force: true, recursive: true})
  })

  it('resolves provider zone id before listing records for a domain filter', async () => {
    const requests: string[] = []
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input))
      requests.push(url.pathname)

      if (url.pathname === '/client/v4/zones') return jsonResponse(cloudflareResponse([{id: 'zone_1', name: 'example.com'}]))
      if (url.pathname === '/client/v4/zones/zone_1/dns_records') return jsonResponse(cloudflareResponse([]))

      throw new Error(`Unexpected request: ${url.href}`)
    }) as typeof fetch

    const {stdout} = await runCommand('domains list --provider cloudflare --domain example.com --json')
    const result = JSON.parse(stdout) as {data: {zones: Array<{zone: {id: string; name: string}}>}; ok: boolean}

    expect(result.ok).to.equal(true)
    expect(result.data.zones[0].zone).to.deep.equal({id: 'zone_1', metadata: {cloudflare: {id: 'zone_1', name: 'example.com'}}, name: 'example.com'})
    expect(requests).to.deep.equal(['/client/v4/zones', '/client/v4/zones/zone_1/dns_records'])
  })

  it('lists zones and records for a named provider account', async () => {
    await saveConfig({providers: {spaceship: {accounts: {work: {credentials: {apiKey: 'work_key', apiSecret: 'work_secret'}}}}}})

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      const headers = init?.headers as Record<string, string>
      expect(headers['X-Api-Key']).to.equal('work_key')

      if (url.hostname === 'spaceship.dev' && url.pathname === '/api/v1/domains') {
        return jsonResponse({items: [{name: 'example.com'}], total: 1})
      }

      if (url.hostname === 'spaceship.dev' && url.pathname === '/api/v1/dns/records/example.com') {
        return jsonResponse({items: [], total: 0})
      }

      throw new Error(`Unexpected request: ${url.href}`)
    }) as typeof fetch

    const {stdout} = await runCommand('domains list --provider spaceship --account work --json')
    const result = JSON.parse(stdout) as {
      data: {account: string; provider: string; zones: Array<{account: string; isDefaultAccount: boolean; zone: {name: string}}>}
      ok: boolean
    }

    expect(result.ok).to.equal(true)
    expect(result.data.provider).to.equal('spaceship')
    expect(result.data.account).to.equal('work')
    expect(result.data.zones[0]).to.deep.include({account: 'work', isDefaultAccount: false})
    expect(result.data.zones[0].zone.name).to.equal('example.com')
  })
})
