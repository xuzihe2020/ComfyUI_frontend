export const EDITOR_BINDING_PROPERTY = 'comfyui_editor_bridge'

export type EditorBindingMetadata = {
  version: 1
  endpoint: {
    key: string
    label?: string
    expose_all_fields: true
    field_config: Record<string, Record<string, unknown>>
  }
}

const ENDPOINT_KEY = /^[a-z][a-z0-9_]{0,63}$/

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readEditorBinding(
  value: unknown
): EditorBindingMetadata | null {
  const metadata = objectValue(value)
  const endpoint = objectValue(metadata?.endpoint)
  const fieldConfig = objectValue(endpoint?.field_config)
  if (
    metadata?.version !== 1 ||
    typeof endpoint?.key !== 'string' ||
    !ENDPOINT_KEY.test(endpoint.key) ||
    endpoint.expose_all_fields !== true ||
    !fieldConfig
  ) {
    return null
  }
  return {
    version: 1,
    endpoint: {
      key: endpoint.key,
      ...(typeof endpoint.label === 'string' && endpoint.label
        ? { label: endpoint.label }
        : {}),
      expose_all_fields: true,
      field_config: fieldConfig as Record<string, Record<string, unknown>>
    }
  }
}

export function createEditorBinding(
  key: string,
  label: string,
  fieldConfig: unknown
): EditorBindingMetadata {
  const normalizedKey = key.trim()
  if (!ENDPOINT_KEY.test(normalizedKey)) {
    throw new Error('Endpoint key must match ^[a-z][a-z0-9_]{0,63}$.')
  }
  const normalizedFields = objectValue(fieldConfig)
  if (!normalizedFields) {
    throw new Error('Field hints must be a JSON object.')
  }
  for (const [field, hint] of Object.entries(normalizedFields)) {
    if (!field || !objectValue(hint)) {
      throw new Error(`Field hint ${field || '(empty)'} must be a JSON object.`)
    }
  }
  return {
    version: 1,
    endpoint: {
      key: normalizedKey,
      ...(label.trim() ? { label: label.trim() } : {}),
      expose_all_fields: true,
      field_config: normalizedFields as Record<string, Record<string, unknown>>
    }
  }
}
