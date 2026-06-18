import { graphService } from './graph.service'
import { CongestionForecast } from './simulation.service'

export interface FleetMember {
  id: string
  name: string
  current_lat: number
  current_lon: number
}

export interface HistoricalPrecedent {
  avgSecondaryIncidents: number
  summary: string
}

export interface DispatchContext {
  event: {
    category: string
    affected_corridors: string[] | null
    requires_road_closure: boolean
  }
  forecast: CongestionForecast
  precedents: HistoricalPrecedent
  availableFleet: FleetMember[]
}

export interface Deployment {
  junction: string
  junctionName: string
  fleet_count: number
  role: string
  priority: string
  deployByMins: number
  user_id: string
  user_name: string
}

export interface DispatchPlan {
  total_fleet_required: number
  rationale: string
  deployments: Deployment[]
}

const PRECEDENT_TABLE: Record<string, HistoricalPrecedent> = {
  public_event: {
    avgSecondaryIncidents: 1.8,
    summary:
      'Public events of comparable crowd size have historically triggered 1-2 secondary congestion incidents on adjoining corridors within 30 minutes.',
  },
  vehicle_breakdown: {
    avgSecondaryIncidents: 0.6,
    summary:
      'Vehicle breakdowns rarely cascade beyond the immediate junction, but lane-blocking cases during peak hours produced secondary slowdowns in roughly 30% of past incidents.',
  },
  accident: {
    avgSecondaryIncidents: 1.3,
    summary:
      'Accidents of comparable severity led to an average of 1.3 secondary incidents nearby, typically at downstream junctions within 15 minutes.',
  },
  road_work: {
    avgSecondaryIncidents: 0.9,
    summary:
      'Planned road work has a moderate secondary incident rate, concentrated at diversion entry points.',
  },
}

const DEFAULT_PRECEDENT: HistoricalPrecedent = {
  avgSecondaryIncidents: 1.0,
  summary: 'No close historical match found; using the citywide baseline secondary incident rate.',
}

/**
 * Stand-in for the ML fingerprinting service referenced in the feature spec
 * (not built yet) — returns a category-keyed historical summary.
 */
export function getHistoricalPrecedents(category: string): HistoricalPrecedent {
  return PRECEDENT_TABLE[category] ?? DEFAULT_PRECEDENT
}

const ESCALATION_TIERS = [
  { role: 'traffic_direction', priority: 'Critical', deployByMins: 0 },
  { role: 'incident_clearance', priority: 'High', deployByMins: 10 },
  { role: 'diversion_management', priority: 'Medium', deployByMins: 25 },
]

/**
 * Deterministic, rule-based stand-in for the LLM dispatch call (Phase 4 of
 * the feature spec, not implemented yet). Ranks forecasted junctions by how
 * soon they're expected to congest, then assigns the nearest available fleet
 * member to each.
 */
export function generateDispatchPlan(context: DispatchContext): DispatchPlan {
  const { event, forecast, precedents, availableFleet } = context

  const t15New = forecast.t15_nodes.filter((id) => !forecast.t0_nodes.includes(id))
  const t30New = forecast.t30_nodes.filter((id) => !forecast.t15_nodes.includes(id))

  const targets = [
    ...forecast.t0_nodes.map((id) => ({ id, ...ESCALATION_TIERS[0] })),
    ...t15New.map((id) => ({ id, ...ESCALATION_TIERS[1] })),
    ...t30New.map((id) => ({ id, ...ESCALATION_TIERS[2] })),
  ].slice(0, availableFleet.length)

  const fleetPool = [...availableFleet]
  const deployments: Deployment[] = []

  for (const target of targets) {
    const junction = graphService.junctions.get(target.id)
    if (!junction || fleetPool.length === 0) continue

    let nearestIdx = 0
    let minDist = Infinity
    fleetPool.forEach((member, idx) => {
      const dist = Math.hypot(member.current_lat - junction.lat, member.current_lon - junction.lon)
      if (dist < minDist) {
        minDist = dist
        nearestIdx = idx
      }
    })
    const [assigned] = fleetPool.splice(nearestIdx, 1)

    deployments.push({
      junction: target.id,
      junctionName: junction.name,
      fleet_count: 1,
      role: target.role,
      priority: target.priority,
      deployByMins: target.deployByMins,
      user_id: assigned.id,
      user_name: assigned.name,
    })
  }

  const corridorList = event.affected_corridors?.join(', ') || 'the affected corridors'
  const rationale = deployments.length
    ? `Propagation model forecasts congestion reaching ${deployments.map((d) => d.junctionName).join(', ')} within 30 minutes along ${corridorList}. ${precedents.summary} Pre-positioning fleet now should contain spillover before it compounds.`
    : `No junctions are forecasted to exceed the spread threshold in the next 30 minutes; holding fleet on standby. ${precedents.summary}`

  return {
    total_fleet_required: deployments.length,
    rationale,
    deployments,
  }
}
