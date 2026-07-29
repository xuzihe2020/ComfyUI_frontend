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
    const properties = objectValue(node?.properties)
    const metadata = objectValue(properties?.comfyui_editor_bridge)
    const nodeId = node?.id
    const nodeType = node?.type
    if (
      !metadata ||
      (typeof nodeId !== 'string' && typeof nodeId !== 'number') ||
      typeof nodeType !== 'string'
    ) {
      continue
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
