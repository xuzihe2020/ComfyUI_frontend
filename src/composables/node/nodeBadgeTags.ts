import type { LGraphBadge } from '@/lib/litegraph/src/LGraphBadge'

const CORE_NODE_BADGE_TAG = Symbol('comfy-core-node-badge')

type NodeBadgeEntry = LGraphBadge | (() => LGraphBadge)
type TaggedBadgeGetter = (() => LGraphBadge) & {
  [CORE_NODE_BADGE_TAG]?: true
}

export function markCoreNodeBadge(getter: () => LGraphBadge) {
  Object.defineProperty(getter, CORE_NODE_BADGE_TAG, { value: true })
  return getter as TaggedBadgeGetter
}

export function withoutCoreNodeBadge<T extends NodeBadgeEntry>(badges: T[]) {
  return badges.filter(
    (badge) =>
      typeof badge !== 'function' ||
      !(badge as TaggedBadgeGetter)[CORE_NODE_BADGE_TAG]
  )
}
