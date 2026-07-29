import { describe, expect, it } from 'vitest'

import { createEditorBinding, readEditorBinding } from './editorBridgeBinding'

describe('editorBridgeBinding', () => {
  it('creates versioned metadata that exposes all fields', () => {
    expect(
      createEditorBinding('input_image_01', 'Primary image', {
        image: { kind: 'image', required_from_editor: true }
      })
    ).toEqual({
      version: 1,
      endpoint: {
        key: 'input_image_01',
        label: 'Primary image',
        expose_all_fields: true,
        field_config: {
          image: { kind: 'image', required_from_editor: true }
        }
      }
    })
  })

  it('rejects invalid endpoint keys and non-object hints', () => {
    expect(() => createEditorBinding('Input Image', '', {})).toThrow(
      'Endpoint key'
    )
    expect(() => createEditorBinding('input_image', '', [])).toThrow(
      'Field hints'
    )
  })

  it('rejects malformed persisted metadata', () => {
    expect(
      readEditorBinding({
        version: 1,
        endpoint: {
          key: 'image',
          expose_all_fields: false,
          field_config: {}
        }
      })
    ).toBeNull()
  })
})
