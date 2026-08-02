import config from '@/config'
import { api } from '@/scripts/api'
import { app } from '@/scripts/app'

const COMPILED_WORKFLOW_ENDPOINT =
  '/editor-bridge/v1/workflows/compiled' as const

type EditorBinding = {
  node_id: string | number
  node_type: string
  title?: string
  graph_scope: 'top_level'
  metadata: Record<string, unknown>
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function collectSubgraphDefinitions(workflow: Record<string, unknown>) {
  const collected: Record<string, unknown>[] = []
  function visit(owner: Record<string, unknown>) {
    const definitions = objectValue(owner.definitions)
    const subgraphs = Array.isArray(definitions?.subgraphs)
      ? definitions.subgraphs
      : []
    for (const value of subgraphs) {
      const definition = objectValue(value)
      if (!definition) continue
      collected.push(definition)
      visit(definition)
    }
  }
  visit(workflow)
  return collected
}

function sameNodeId(left: unknown, right: unknown) {
  return (
    (typeof left === 'string' || typeof left === 'number') &&
    (typeof right === 'string' || typeof right === 'number') &&
    String(left) === String(right)
  )
}

function primitiveTarget(
  workflow: Record<string, unknown>,
  nodes: unknown[],
  primitive: Record<string, unknown>
) {
  const links = Array.isArray(workflow.links) ? workflow.links : []
  const targets = new Map<string, { nodeId: string | number; slot: number }>()
  for (const linkValue of links) {
    const link = objectValue(linkValue)
    const originId = Array.isArray(linkValue) ? linkValue[1] : link?.origin_id
    const targetId = Array.isArray(linkValue) ? linkValue[3] : link?.target_id
    const targetSlot = Array.isArray(linkValue)
      ? linkValue[4]
      : link?.target_slot
    if (
      !sameNodeId(originId, primitive.id) ||
      (typeof targetId !== 'string' && typeof targetId !== 'number') ||
      typeof targetSlot !== 'number'
    ) {
      continue
    }
    targets.set(`${String(targetId)}:${targetSlot}`, {
      nodeId: targetId,
      slot: targetSlot
    })
  }
  if (targets.size !== 1) {
    throw new Error(
      `Primitive editor binding on node ${String(primitive.id)} must control exactly one executable ComfyUI input.`
    )
  }
  const [{ nodeId, slot }] = targets.values()
  const target = nodes
    .map(objectValue)
    .find((candidate) => sameNodeId(candidate?.id, nodeId))
  const inputs = Array.isArray(target?.inputs) ? target.inputs : []
  const input = objectValue(inputs[slot])
  if (typeof target?.type !== 'string' || typeof input?.name !== 'string') {
    throw new Error(
      `Primitive editor binding on node ${String(primitive.id)} does not resolve to an executable ComfyUI input.`
    )
  }
  return { nodeId, nodeType: target.type }
}

export function extractEditorBindings(workflow: unknown): EditorBinding[] {
  const workflowObject = objectValue(workflow)
  if (!workflowObject) return []
  const nodes = workflowObject.nodes
  if (!Array.isArray(nodes)) return []
  const subgraphs = collectSubgraphDefinitions(workflowObject)
  const subgraphTypes = new Set(
    subgraphs.flatMap((definition) =>
      typeof definition.id === 'string' ? [definition.id] : []
    )
  )

  for (const definition of subgraphs) {
    const definitionNodes = Array.isArray(definition.nodes)
      ? definition.nodes
      : []
    for (const nodeValue of definitionNodes) {
      const node = objectValue(nodeValue)
      const properties = objectValue(node?.properties)
      if (objectValue(properties?.comfyui_editor_bridge)) {
        const definitionName =
          typeof definition.name === 'string'
            ? definition.name
            : String(definition.id ?? 'unknown')
        throw new Error(
          `Editor binding on node ${String(node?.id ?? 'unknown')} inside subgraph ${definitionName} is unsupported. Move a loader, config, or save adapter to the top-level workflow and bind that node.`
        )
      }
    }
  }

  const bindings: EditorBinding[] = []
  for (const nodeValue of nodes) {
    const node = objectValue(nodeValue)
    if (!node) continue
    const properties = objectValue(node?.properties)
    const metadata = objectValue(properties?.comfyui_editor_bridge)
    let nodeId = node?.id
    let nodeType = node?.type
    if (
      !metadata ||
      (typeof nodeId !== 'string' && typeof nodeId !== 'number') ||
      typeof nodeType !== 'string'
    ) {
      continue
    }
    if (nodeType === 'PrimitiveNode') {
      const target = primitiveTarget(workflowObject, nodes, node)
      nodeId = target.nodeId
      nodeType = target.nodeType
    }
    if (subgraphTypes.has(nodeType)) {
      throw new Error(
        `Editor binding on subgraph instance ${String(nodeId)} is unsupported. Move a loader, config, or save adapter to the top-level workflow and bind that node.`
      )
    }

    const title = node?.title
    bindings.push({
      node_id: nodeId,
      node_type: nodeType,
      graph_scope: 'top_level',
      ...(typeof title === 'string' && title ? { title } : {}),
      metadata
    })
  }
  return bindings
}

async function responseError(response: Response): Promise<Error> {
  const detail = await response.text()
  return new Error(
    `Editor bridge request failed (${response.status}): ${detail || response.statusText}`
  )
}

/**
 * Compile the active UI workflow through ComfyUI's native graph compiler and
 * persist the resulting API prompt in the editor bridge's disposable cache.
 *
 * The caller must save the UI workflow first. The bridge hashes the persisted
 * UI bytes, making that file the sole source of truth for the cached prompt.
 */
export async function persistNativeCompiledWorkflow(
  workflowPath: string
): Promise<void> {
  const { output, workflow } = await app.graphToPrompt()
  const response = await api.fetchApi(COMPILED_WORKFLOW_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: workflowPath,
      output,
      bindings: extractEditorBindings(workflow),
      frontend_version: config.app_version
    })
  })

  if (!response.ok) throw await responseError(response)
}

/**
 * Remove a disposable compiled sidecar after its source workflow is removed or
 * renamed. Missing sidecars are accepted by the bridge.
 */
export async function deleteNativeCompiledWorkflow(
  workflowPath: string
): Promise<void> {
  const query = new URLSearchParams({ path: workflowPath })
  const response = await api.fetchApi(
    `${COMPILED_WORKFLOW_ENDPOINT}?${query.toString()}`,
    { method: 'DELETE' }
  )

  if (!response.ok) throw await responseError(response)
}
