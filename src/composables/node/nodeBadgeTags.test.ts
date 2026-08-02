import { describe, expect, it } from 'vitest'

import { LGraphBadge } from '@/lib/litegraph/src/LGraphBadge'

import { markCoreNodeBadge, withoutCoreNodeBadge } from './nodeBadgeTags'

describe('node badge tags', () => {
  it('removes the core badge without discarding an earlier extension badge', () => {
    const editorBadge = () => new LGraphBadge({ text: 'EDITOR: denoise_01' })
    const coreBadge = markCoreNodeBadge(
      () => new LGraphBadge({ text: '#26' })
    )

    expect(withoutCoreNodeBadge([editorBadge, coreBadge])).toEqual([
      editorBadge
    ])
    expect(withoutCoreNodeBadge([coreBadge, editorBadge])).toEqual([
      editorBadge
    ])
  })
})
