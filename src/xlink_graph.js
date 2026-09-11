// ═══════════════════════════════════════════════════════════════════
// Cross-event XLINK graph — chain incident traversal
// ───────────────────────────────────────────────────────────────────
// Phase 7 of the recipient chapter shapes design. Pure module.
// Unifies every cross-event link surface into one graph:
//
//   event.linkedEventIds[]                    (bidirectional)
//   event.postIncidentReport.linkedAfterClose (post-close continuations)
//   event.catalog.xlinks[]                    (typed cross-links)
//
// A "chain" is one connected component of the resulting undirected
// graph. Chain incidents are the platform's audit unit for a
// multi-site campaign (drones moving between sites, coordinated
// attacks, temporal-adjacent probing runs). Chain traversal drives:
//
//   - a chain-view panel in the PIR Step 7 section
//   - a chain-scope cross-reference on each contributor chapter
//   - the receiver profile Reports tab's "linked incidents" pivot
//
// Detection-only invariant preserved. This module reads events and
// their sub-records; no writes, no escalations, no dispatch. Chain
// membership is a rendering concern.
//
// Public API:
//   buildXlinkGraph(events)                     → { nodes, edges }
//   chainFor(eventId, events)                   → Chain summary
//   eventsInSameChainAs(eventId, events)        → Event[]
//   chainNarrative(chain)                       → string
//   rolePresenceInChain(chain, roleId)          → PresenceSummary
//
// See docs/cross-agency-flows.md Section 7 "Cross-event chain graph"
// for the graph contract.
// ═══════════════════════════════════════════════════════════════════

// ── Graph build ────────────────────────────────────────────────

// Build the undirected graph over the given events. Returns:
//   nodes: Map<eventId, { id, event, chainId, chainSize }>
//   edges: [{ aId, bId, source, score }]
//   chains: Map<chainId, Chain>
//
// Edge sources tracked so a caller can distinguish an explicit
// operator-authored xlink from an auto-detected correlation link.
// Score is copied from event.correlationScore when the edge came
// through the auto-correlation path; null otherwise.
//
// Chain ids are stable strings of the form "chain-<earliestEventId>"
// so a chain retains identity across re-builds even when a new
// linked event lands mid-render.

export function buildXlinkGraph(events) {
  if (!Array.isArray(events) || !events.length) {
    return { nodes: new Map(), edges: [], chains: new Map() };
  }

  const byId = new Map();
  for (const ev of events) if (ev?.id) byId.set(ev.id, ev);

  // Adjacency: eventId → Set<eventId>
  const adj = new Map();
  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const edgesSeen = new Map(); // key → { aId, bId, source, score }

  const addEdge = (aId, bId, source, score) => {
    if (!aId || !bId || aId === bId) return;
    if (!byId.has(aId) || !byId.has(bId)) return;
    if (!adj.has(aId)) adj.set(aId, new Set());
    if (!adj.has(bId)) adj.set(bId, new Set());
    adj.get(aId).add(bId);
    adj.get(bId).add(aId);
    const k = edgeKey(aId, bId);
    if (!edgesSeen.has(k)) {
      const [x, y] = k.split('|');
      edgesSeen.set(k, { aId: x, bId: y, source, score: score ?? null });
    }
  };

  for (const ev of events) {
    if (!ev?.id) continue;
    // Source 1 · linkedEventIds — auto-correlation output.
    for (const other of (ev.linkedEventIds || [])) {
      addEdge(ev.id, other, 'linkedEventIds', ev.correlationScore || null);
    }
    // Source 2 · post-incident continuations. These are
    // one-directional in the report shape but read as symmetric
    // links here so a viewer coming from the follow-on side still
    // finds the origin event.
    const pir = ev.postIncidentReport;
    if (pir && Array.isArray(pir.linkedAfterClose)) {
      for (const l of pir.linkedAfterClose) {
        addEdge(ev.id, l.id || l.eventId, 'linkedAfterClose', l.correlationScore || null);
      }
    }
    // Source 3 · catalog.xlinks — operator-authored cross-links
    // with a typed reason. Field name across the codebase is
    // fromEventId / toEventId; support both directions defensively.
    const xlinks = ev.catalog?.xlinks;
    if (Array.isArray(xlinks)) {
      for (const x of xlinks) {
        const other = x.toEventId && x.toEventId !== ev.id
                    ? x.toEventId
                    : (x.fromEventId && x.fromEventId !== ev.id ? x.fromEventId : null);
        if (other) addEdge(ev.id, other, 'catalog.xlinks', x.score || null);
      }
    }
  }

  // Connected-component pass — assigns every event to a chain id.
  const nodeChain = new Map();
  const chainMembers = new Map();
  for (const ev of events) {
    if (!ev?.id || nodeChain.has(ev.id)) continue;
    // BFS from this event.
    const queue = [ev.id];
    const component = [];
    while (queue.length) {
      const cur = queue.shift();
      if (nodeChain.has(cur)) continue;
      nodeChain.set(cur, null);
      component.push(cur);
      const neighbours = adj.get(cur);
      if (neighbours) for (const n of neighbours) if (!nodeChain.has(n)) queue.push(n);
    }
    // Chain id = "chain-<earliest event id in the component>".
    component.sort((a, b) => {
      const ta = byId.get(a)?.startTime || '';
      const tb = byId.get(b)?.startTime || '';
      if (ta && tb) return ta.localeCompare(tb);
      if (ta) return -1;
      if (tb) return 1;
      return a.localeCompare(b);
    });
    const chainId = `chain-${component[0]}`;
    for (const id of component) nodeChain.set(id, chainId);
    chainMembers.set(chainId, component);
  }

  // Build the nodes map.
  const nodes = new Map();
  for (const ev of events) {
    if (!ev?.id) continue;
    const chainId = nodeChain.get(ev.id);
    nodes.set(ev.id, {
      id:        ev.id,
      event:     ev,
      chainId,
      chainSize: chainMembers.get(chainId)?.length || 1,
    });
  }

  // Build chains map — chainId → Chain summary.
  const chains = new Map();
  for (const [chainId, memberIds] of chainMembers) {
    const memberEvents = memberIds.map(id => byId.get(id)).filter(Boolean);
    chains.set(chainId, _summariseChain(chainId, memberEvents));
  }

  return {
    nodes,
    edges: Array.from(edgesSeen.values()),
    chains,
  };
}

// ── Public queries ─────────────────────────────────────────────

// Get the chain summary for a specific event. Returns null when the
// event is not in the graph.

export function chainFor(eventId, events) {
  if (!eventId) return null;
  const graph = buildXlinkGraph(events);
  const node = graph.nodes.get(eventId);
  if (!node) return null;
  return graph.chains.get(node.chainId) || null;
}

// Flat list of events in the same chain as the given event id,
// chronological ascending. Includes the source event itself.

export function eventsInSameChainAs(eventId, events) {
  const chain = chainFor(eventId, events);
  return chain ? chain.events.slice() : [];
}

// One-line human summary of a chain. Compact enough for a card
// header; useful in the PIR "Event chain" section.

export function chainNarrative(chain) {
  if (!chain) return '';
  if (chain.size <= 1) {
    return `Single event, no cross-links.`;
  }
  // Reuse the sites array already computed by _summariseChain — one
  // uppercase pass here instead of a second dedupe against chain.events.
  const sites = (chain.sites || []).map(s => String(s || 'unknown').toUpperCase());
  const span = chain.spanMinutes;
  const spanLabel = span == null ? 'unknown span'
                  : span < 1     ? 'under a minute'
                  : span < 60    ? `${span} minute${span === 1 ? '' : 's'}`
                  : `${(span / 60).toFixed(1)} hours`;
  return `${chain.size}-event chain across ${sites.length} site${sites.length === 1 ? '' : 's'} over ${spanLabel}. ${sites.join(' → ')}`;
}

// Which events in a chain does this role touch? Uses the same
// contributor detection as roleWasInvolved so the numbers align
// with what the PIR panel shows. Returns:
//   { eventIds: string[], firstAt: iso, lastAt: iso, chainSize }

export function rolePresenceInChain(chain, roleId) {
  if (!chain || !roleId) return { eventIds: [], firstAt: null, lastAt: null, chainSize: 0 };
  const touched = [];
  for (const ev of chain.events) {
    if (_roleTouchedEvent(ev, roleId)) touched.push(ev);
  }
  const firstAt = touched.length ? touched[0].startTime || null : null;
  const lastAt  = touched.length ? touched[touched.length - 1].endTime || touched[touched.length - 1].closedAt || touched[touched.length - 1].startTime || null : null;
  return {
    eventIds:  touched.map(e => e.id),
    firstAt,
    lastAt,
    chainSize: chain.size,
  };
}

// ── Internals ──────────────────────────────────────────────────

function _summariseChain(chainId, memberEvents) {
  const events = memberEvents.slice().sort((a, b) => {
    const ta = a.startTime || '';
    const tb = b.startTime || '';
    return ta.localeCompare(tb);
  });
  const firstAt = events[0]?.startTime || null;
  const lastAt = events[events.length - 1]?.endTime
              || events[events.length - 1]?.closedAt
              || events[events.length - 1]?.startTime
              || null;
  let spanMinutes = null;
  if (firstAt && lastAt) {
    const dt = (Date.parse(lastAt) - Date.parse(firstAt)) / 60000;
    if (!isNaN(dt) && dt >= 0) spanMinutes = Math.round(dt);
  }
  const sites = Array.from(new Set(events.map(e => e.siteId).filter(Boolean)));
  return {
    id:         chainId,
    events,
    size:       events.length,
    firstAt,
    lastAt,
    spanMinutes,
    sites,
  };
}

// Same authorship check as chapter_composer.roleWasInvolved but
// duplicated here to keep xlink_graph independent from the
// chapter composer (avoids a circular import + lets xlink_graph
// live upstream of the composer in future refactors).

function _roleTouchedEvent(event, roleId) {
  if (!event || !roleId) return false;
  if (Array.isArray(event.escalations)) {
    for (const r of event.escalations) {
      if (r.initiatedByRoleId === roleId) return true;
      if (r.destinationId === roleId) return true;
    }
  }
  if (Array.isArray(event.counterDispatches)) {
    for (const cd of event.counterDispatches) {
      if (cd.ownerRoleId === roleId) return true;
    }
  }
  const cat = event.catalog;
  if (cat && typeof cat === 'object') {
    for (const key of Object.keys(cat)) {
      const arr = cat[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry?.authorRoleId === roleId) return true;
      }
    }
  }
  return false;
}
