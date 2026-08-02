import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { LGraphBadge } from '@/lib/litegraph/src/LGraphBadge'
import { t } from '@/i18n'
import {
  createEditorBinding,
  EDITOR_BINDING_PROPERTY,
  readEditorBinding
} from '@/platform/workflow/persistence/editorBridgeBinding'
import { app } from '@/scripts/app'
import { useDialogService } from '@/services/dialogService'

import EditorBridgeBindingDialog from './EditorBridgeBindingDialog.vue'
import {
  collectEditorBindingFields,
  duplicateEndpointNodeId
} from './editorBridgeBindingFields'
import type { EditorBindingDialogDraft } from './editorBridgeBindingFields'

function editorBindingBadge(node: LGraphNode) {
  const binding = readEditorBinding(
    node.properties?.[EDITOR_BINDING_PROPERTY]
  )
  return new LGraphBadge({
    text: binding
      ? t('editorBridgeBinding.badge', { key: binding.endpoint.key })
      : '',
    fgColor: '#ffffff',
    bgColor: '#c2410c',
    onClick: binding ? () => editBinding(node) : undefined
  })
}

function saveBinding(node: LGraphNode, draft: EditorBindingDialogDraft) {
  try {
    const metadata = createEditorBinding(
      draft.key,
      draft.label,
      draft.fieldConfig
    )
    const duplicateId = duplicateEndpointNodeId(
      node.graph?.nodes ?? [],
      node.id,
      metadata.endpoint.key,
      readEditorBinding
    )
    if (duplicateId !== undefined) {
      return t('editorBridgeBinding.duplicateKey', {
        key: metadata.endpoint.key,
        id: duplicateId
      })
    }
    node.graph?.beforeChange(node)
    node.setProperty(EDITOR_BINDING_PROPERTY, metadata)
    node.graph?.afterChange(node)
    node.setDirtyCanvas(true, true)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function removeBinding(node: LGraphNode) {
  node.graph?.beforeChange(node)
  delete node.properties?.[EDITOR_BINDING_PROPERTY]
  node.graph?.afterChange(node)
  node.setDirtyCanvas(true, true)
}

function unsupportedSubgraphReason(node: LGraphNode) {
  if (node.isSubgraphNode() || node.graph?.isRootGraph === false) {
    return t('editorBridgeBinding.subgraphUnsupported')
  }
  return ''
}

function editBinding(node: LGraphNode) {
  const existing = readEditorBinding(node.properties?.[EDITOR_BINDING_PROPERTY])
  const unsupportedReason = unsupportedSubgraphReason(node)
  useDialogService().showExtensionDialog({
    key: `editor-bridge-binding-${node.id}`,
    title: t('editorBridgeBinding.title'),
    component: EditorBridgeBindingDialog,
    props: {
      nodeTitle:
        node.title ?? node.comfyClass ?? t('editorBridgeBinding.title'),
      backendClass: node.comfyClass ?? '',
      nodeId: String(node.id),
      fields: collectEditorBindingFields(node),
      initialKey: existing?.endpoint.key ?? '',
      initialLabel: existing?.endpoint.label ?? '',
      initialFieldConfig: existing?.endpoint.field_config ?? {},
      canRemove: Boolean(existing),
      unsupportedReason,
      onSave: (draft: EditorBindingDialogDraft) =>
        unsupportedReason || saveBinding(node, draft),
      onRemove: () => removeBinding(node)
    },
    dialogComponentProps: {
      renderer: 'reka',
      modal: true,
      closable: true,
      size: 'lg',
      contentClass: 'w-full max-w-3xl'
    }
  })
}

app.registerExtension({
  name: 'Comfy.EditorBridgeBinding',
  nodeCreated(node) {
    node.badges.push(() => editorBindingBadge(node))
  },
  getNodeMenuItems(node) {
    const existing = readEditorBinding(
      node.properties?.[EDITOR_BINDING_PROPERTY]
    )
    const unsupportedReason = unsupportedSubgraphReason(node)
    if (unsupportedReason && !existing) {
      return [
        {
          content: t('editorBridgeBinding.subgraphMenu'),
          disabled: true
        }
      ]
    }
    return [
      {
        content: existing
          ? t('editorBridgeBinding.editMenu')
          : t('editorBridgeBinding.exposeMenu'),
        callback: () => editBinding(node)
      }
    ]
  }
})
