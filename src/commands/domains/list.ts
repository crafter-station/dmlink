import {Command} from '@oclif/core'

import {loadConfig} from '../../lib/config.js'
import {domainFlag, jsonFlag, providerFlag} from '../../lib/flags.js'
import {createOutput, outputError} from '../../lib/output.js'
import {createProvider} from '../../lib/providers/registry.js'
import type {DnsZone} from '../../lib/providers/types.js'
import {normalizeDomain} from '../../lib/validate.js'

async function resolveZones(provider: Awaited<ReturnType<typeof createProvider>>, domain?: string): Promise<DnsZone[]> {
  if (!domain) return provider.listZones()

  const normalized = normalizeDomain(domain)
  const zone = await provider.getZone(normalized)
  if (!zone) throw new Error(`${provider.name} does not have a DNS zone for ${normalized}.`)
  return [zone]
}

export default class DomainsList extends Command {
  static description = 'List DNS zones and records for a provider.'

  static flags = {
    domain: domainFlag,
    json: jsonFlag,
    provider: providerFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DomainsList)
    const out = createOutput({json: flags.json})

    try {
      const config = await loadConfig()
      const provider = await createProvider(flags.provider ?? process.env.DOOMAIN_PROVIDER ?? config.defaults?.provider ?? 'spaceship')
      const zones = await resolveZones(provider, flags.domain)
      const results = []

      for (const zone of zones) {
        const records = await provider.listRecords(zone)
        results.push({zone, records})
        out.info(`${zone.name} (${records.length} records)`)
        for (const record of records) out.info(`  ${record.type} ${record.name} -> ${record.value}`)
      }

      out.result({provider: provider.id, zones: results})
    } catch (error) {
      outputError(out.json, error, 'DOMAIN_LINK_FAILED')
      this.exit(1)
    }
  }
}
