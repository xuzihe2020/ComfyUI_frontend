import { describe, expect, it, vi } from 'vitest'

import { createEditorBinding } from '@/platform/workflow/persistence/editorBridgeBinding'

const { state } = vi.hoisted(() => ({
  state: {
    extension: null as {
      nodeCreated: (node: {
        badges: Array<() => { text: string; onClick?: () => void }>
        properties: Record<string, unknown>
      }) => void
    } | null
  }
}))

vi.mock('@/scripts/app', () => ({
  app: {
    registerExtension: (extension: typeof state.extension) => {
      state.extension = extension
    }
  }
}))

vi.mock('@/services/dialogService', () => ({
  useDialogService: () => ({ showExtensionDialog: vi.fn() })
}))

await import('./editorBridgeBinding')

function makeNode(exposed = false) {
  return {
    badges: [] as Array<() => { text: string; onClick?: () => void }>,
    properties: exposed
      ? {
          comfyui_editor_bridge: createEditorBinding(
            'checkpoint_01',
            '',
            {}
          )
        }
      : ({} as Record<string, unknown>)
  }
}

describe('Comfy.EditorBridgeBinding node badge', () => {
  it('shows the endpoint key for an exposed node loaded from a workflow', () => {
    const node = makeNode(true)
    state.extension!.nodeCreated(node)

    const badge = node.badges[0]()
    expect(badge.text).toBe('EDITOR: checkpoint_01')
    expect(badge.onClick).toBeTypeOf('function')
  })

  it('updates when exposure is added or removed', () => {
    const node = makeNode()
    state.extension!.nodeCreated(node)
    const getBadge = node.badges[0]

    expect(getBadge().text).toBe('')

    node.properties.comfyui_editor_bridge = createEditorBinding(
      'input_image_01',
      '',
      {}
    )
    expect(getBadge().text).toBe('EDITOR: input_image_01')

    delete node.properties.comfyui_editor_bridge
    expect(getBadge().text).toBe('')
  })
})
