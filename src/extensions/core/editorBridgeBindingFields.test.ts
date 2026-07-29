import { describe, expect, it } from 'vitest'

import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { readEditorBinding } from '@/platform/workflow/persistence/editorBridgeBinding'

import {
  collectEditorBindingFields,
  duplicateEndpointNodeId
} from './editorBridgeBindingFields'

describe('editorBridgeBindingFields', () => {
  it('lists serializable widgets and inputs while marking graph links', () => {
    const node = {
      widgets: [
        { name: 'cfg', type: 'number', options: {} },
        {
          name: 'button',
          type: 'button',
          options: { serialize: false }
        }
      ],
      inputs: [
        { name: 'model', type: 'MODEL', link: 4 },
        { name: 'cfg', type: 'FLOAT', link: null }
      ]
    } as unknown as LGraphNode

    expect(collectEditorBindingFields(node)).toEqual([
      { name: 'cfg', type: 'FLOAT', connected: false },
      { name: 'model', type: 'MODEL', connected: true }
    ])
  })

  it('finds duplicate endpoint keys on other graph nodes', () => {
    const metadata = {
      version: 1,
      endpoint: {
        key: 'input_image_01',
        expose_all_fields: true,
        field_config: {}
      }
    }
    expect(
      duplicateEndpointNodeId(
        [
          { id: 1, properties: { comfyui_editor_bridge: metadata } },
          { id: 2, properties: { comfyui_editor_bridge: metadata } }
        ],
        1,
        'input_image_01',
        readEditorBinding
      )
    ).toBe(2)
  })
})
