import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteNativeCompiledWorkflow,
  extractEditorBindings,
  persistNativeCompiledWorkflow
} from './editorBridgeWorkflowService'

const { mockFetchApi, mockGraphToPrompt } = vi.hoisted(() => ({
  mockFetchApi: vi.fn(),
  mockGraphToPrompt: vi.fn()
}))

vi.mock('@/config', () => ({
  default: { app_version: '1.45.15-test' }
}))

vi.mock('@/scripts/api', () => ({
  api: { fetchApi: mockFetchApi }
}))

vi.mock('@/scripts/app', () => ({
  app: { graphToPrompt: mockGraphToPrompt }
}))

describe('editorBridgeWorkflowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchApi.mockResolvedValue(
      new Response(null, { status: 204, statusText: 'No Content' })
    )
  })

  it('persists the native API prompt for the saved workflow path', async () => {
    const output = { '1': { class_type: 'KSampler', inputs: { seed: 42 } } }
    const workflow = {
      nodes: [
        {
          id: 7,
          type: 'LoadImage',
          title: 'Editor input',
          properties: {
            comfyui_editor_bridge: {
              version: 1,
              endpoint: {
                key: 'input_image_01',
                expose_all_fields: true
              }
            }
          }
        }
      ]
    }
    mockGraphToPrompt.mockResolvedValue({ output, workflow })

    await persistNativeCompiledWorkflow('workflows/prod/inpaint.json')

    expect(mockGraphToPrompt).toHaveBeenCalledOnce()
    expect(mockFetchApi).toHaveBeenCalledWith(
      '/editor-bridge/v1/workflows/compiled',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'workflows/prod/inpaint.json',
          output,
          bindings: [
            {
              node_id: 7,
              node_type: 'LoadImage',
              graph_scope: 'top_level',
              title: 'Editor input',
              metadata: workflow.nodes[0].properties.comfyui_editor_bridge
            }
          ],
          frontend_version: '1.45.15-test'
        })
      }
    )
  })

  it('deletes the disposable sidecar using an encoded workflow path', async () => {
    await deleteNativeCompiledWorkflow('workflows/prod/my workflow.json')

    expect(mockFetchApi).toHaveBeenCalledWith(
      '/editor-bridge/v1/workflows/compiled?path=workflows%2Fprod%2Fmy+workflow.json',
      { method: 'DELETE' }
    )
  })

  it('surfaces bridge response details', async () => {
    mockGraphToPrompt.mockResolvedValue({ output: {}, workflow: { nodes: [] } })
    mockFetchApi.mockResolvedValue(
      new Response('bridge is unavailable', {
        status: 404,
        statusText: 'Not Found'
      })
    )

    await expect(
      persistNativeCompiledWorkflow('workflows/prod/inpaint.json')
    ).rejects.toThrow(
      'Editor bridge request failed (404): bridge is unavailable'
    )
  })

  it('ignores malformed and unbound workflow nodes', () => {
    expect(
      extractEditorBindings({
        nodes: [
          null,
          { id: 1, type: 'LoadImage', properties: {} },
          {
            id: '2',
            type: 'KSampler',
            properties: {
              comfyui_editor_bridge: {
                version: 1,
                endpoint: { key: 'sampler' }
              }
            }
          }
        ]
      })
    ).toEqual([
      {
        node_id: '2',
        node_type: 'KSampler',
        graph_scope: 'top_level',
        metadata: { version: 1, endpoint: { key: 'sampler' } }
      }
    ])
  })

  it('compiles a primitive binding against its downstream backend input', () => {
    const metadata = {
      version: 1,
      endpoint: {
        key: 'denoise_01',
        expose_all_fields: true,
        field_config: {
          denoise: { required_from_editor: true, kind: 'string' }
        }
      }
    }
    expect(
      extractEditorBindings({
        nodes: [
          {
            id: 26,
            type: 'PrimitiveNode',
            title: 'Denoise',
            outputs: [{ links: [41] }],
            properties: { comfyui_editor_bridge: metadata }
          },
          {
            id: 17,
            type: 'SplitSigmasDenoise',
            inputs: [
              { name: 'sigmas', type: 'SIGMAS' },
              { name: 'denoise', type: 'FLOAT' }
            ],
            properties: {}
          }
        ],
        links: [[41, 26, 0, 17, 1, 'FLOAT']]
      })
    ).toEqual([
      {
        node_id: 17,
        node_type: 'SplitSigmasDenoise',
        graph_scope: 'top_level',
        title: 'Denoise',
        metadata
      }
    ])
  })

  it('rejects a primitive binding that fans out to multiple inputs', () => {
    const metadata = {
      version: 1,
      endpoint: { key: 'shared_value', expose_all_fields: true }
    }
    expect(() =>
      extractEditorBindings({
        nodes: [
          {
            id: 3,
            type: 'PrimitiveNode',
            properties: { comfyui_editor_bridge: metadata }
          },
          { id: 4, type: 'NodeA', inputs: [{ name: 'value' }] },
          { id: 5, type: 'NodeB', inputs: [{ name: 'value' }] }
        ],
        links: [
          [1, 3, 0, 4, 0, 'FLOAT'],
          [2, 3, 0, 5, 0, 'FLOAT']
        ]
      })
    ).toThrow('must control exactly one executable ComfyUI input')
  })

  it('rejects bindings on subgraph instances and inside definitions', () => {
    const metadata = {
      version: 1,
      endpoint: { key: 'input_image', expose_all_fields: true }
    }
    expect(() =>
      extractEditorBindings({
        nodes: [
          {
            id: 5,
            type: 'subgraph-definition',
            properties: { comfyui_editor_bridge: metadata }
          }
        ],
        definitions: {
          subgraphs: [
            {
              id: 'subgraph-definition',
              name: 'Inpaint internals',
              nodes: []
            }
          ]
        }
      })
    ).toThrow('subgraph instance 5')

    expect(() =>
      extractEditorBindings({
        nodes: [],
        definitions: {
          subgraphs: [
            {
              id: 'subgraph-definition',
              name: 'Inpaint internals',
              nodes: [
                {
                  id: 9,
                  type: 'LoadImage',
                  properties: { comfyui_editor_bridge: metadata }
                }
              ]
            }
          ]
        }
      })
    ).toThrow('inside subgraph Inpaint internals')

    expect(() =>
      extractEditorBindings({
        nodes: [],
        definitions: {
          subgraphs: [
            {
              id: 'outer',
              name: 'Outer',
              nodes: [],
              definitions: {
                subgraphs: [
                  {
                    id: 'inner',
                    name: 'Nested internals',
                    nodes: [
                      {
                        id: 10,
                        type: 'LoadImage',
                        properties: { comfyui_editor_bridge: metadata }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      })
    ).toThrow('inside subgraph Nested internals')
  })
})
