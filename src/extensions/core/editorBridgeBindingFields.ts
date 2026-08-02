import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import type { EditorBindingMetadata } from '@/platform/workflow/persistence/editorBridgeBinding'

export type EditorBindingField = {
  name: string
  type: string
  connected: boolean
}

export type EditorBindingDialogDraft = {
  key: string
  label: string
  fieldConfig: Record<string, Record<string, unknown>>
}

export type PrimitiveEditorBindingTarget = {
  node: LGraphNode
  field: EditorBindingField
}

type BindingNodeSummary = {
  id: string | number
  properties?: Record<string, unknown>
}

function typeLabel(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(' | ')
  return typeof value === 'string' ? value : String(value ?? 'unknown')
}

export function collectEditorBindingFields(node: LGraphNode) {
  const fields = new Map<string, EditorBindingField>()
  for (const widget of node.widgets ?? []) {
    if (!widget.name || widget.options?.serialize === false) continue
    fields.set(widget.name, {
      name: widget.name,
      type: String(widget.type || 'widget'),
      connected: false
    })
  }
  for (const input of node.inputs ?? []) {
    if (!input.name) continue
    const existing = fields.get(input.name)
    fields.set(input.name, {
      name: input.name,
      type: typeLabel(input.type),
      connected: input.link !== null || existing?.connected === true
    })
  }
  return [...fields.values()]
}

export function collectPrimitiveEditorBindingTargets(
  node: LGraphNode
): PrimitiveEditorBindingTarget[] {
  if (node.type !== 'PrimitiveNode' || !node.graph) return []
  const targets = new Map<string, PrimitiveEditorBindingTarget>()
  for (const output of node.outputs ?? []) {
    for (const linkId of output.links ?? []) {
      const link = node.graph.links[linkId]
      if (!link) continue
      const targetNode = node.graph.getNodeById(link.target_id)
      const input = targetNode?.inputs?.[link.target_slot]
      if (!targetNode?.comfyClass || !input?.name) continue
      targets.set(`${String(targetNode.id)}:${link.target_slot}`, {
        node: targetNode,
        field: {
          name: input.name,
          type: typeLabel(input.type),
          connected: false
        }
      })
    }
  }
  return [...targets.values()]
}

export function duplicateEndpointNodeId(
  nodes: BindingNodeSummary[],
  currentNodeId: string | number,
  endpointKey: string,
  readBinding: (value: unknown) => EditorBindingMetadata | null
) {
  const duplicate = nodes.find((candidate) => {
    if (String(candidate.id) === String(currentNodeId)) return false
    return (
      readBinding(candidate.properties?.comfyui_editor_bridge)?.endpoint.key ===
      endpointKey
    )
  })
  return duplicate?.id
}
