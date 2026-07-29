<template>
  <section class="flex max-h-screen flex-col gap-5 overflow-y-auto p-6">
    <header class="flex flex-col gap-1">
      <h2 class="m-0 text-lg font-semibold">
        {{ t('editorBridgeBinding.title') }}
      </h2>
      <p class="m-0 text-sm text-muted-foreground">
        {{ nodeTitle }} ·
        {{ backendClass || t('editorBridgeBinding.noBackend') }} ·
        {{ t('editorBridgeBinding.nodeId', { id: nodeId }) }}
      </p>
    </header>

    <div
      v-if="!backendClass"
      role="status"
      class="rounded-lg bg-secondary-background p-4 text-sm"
    >
      {{ t('editorBridgeBinding.nonExecutable') }}
    </div>

    <div
      v-else-if="unsupportedReason"
      role="alert"
      class="rounded-lg bg-warning-background p-4 text-sm"
    >
      {{ unsupportedReason }}
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('editorBridgeBinding.endpointKey') }}</span>
          <Input
            v-model="endpointKey"
            :placeholder="t('editorBridgeBinding.endpointPlaceholder')"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span>{{ t('editorBridgeBinding.label') }}</span>
          <Input v-model="endpointLabel" />
        </label>
      </div>

      <div class="flex flex-col gap-3">
        <div>
          <h3 class="m-0 text-sm font-semibold">
            {{ t('editorBridgeBinding.fieldsTitle') }}
          </h3>
          <p class="m-0 mt-1 text-sm text-muted-foreground">
            {{ t('editorBridgeBinding.fieldsDescription') }}
          </p>
        </div>

        <div
          v-if="!fieldStates.length"
          role="status"
          class="rounded-lg bg-secondary-background p-4 text-sm"
        >
          {{ t('editorBridgeBinding.noFields') }}
        </div>

        <article
          v-for="(field, index) in fieldStates"
          :key="field.name"
          class="flex flex-col gap-3 rounded-lg bg-secondary-background p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-col">
              <strong class="text-sm">{{ field.name }}</strong>
              <span class="text-xs text-muted-foreground">{{
                field.type
              }}</span>
            </div>
            <span
              v-if="field.connected"
              class="rounded-md bg-tertiary-background px-2 py-1 text-xs"
            >
              {{ t('editorBridgeBinding.graphProvided') }}
            </span>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex items-center gap-2 text-sm">
              <input
                v-model="field.required"
                type="checkbox"
                class="size-4 cursor-pointer"
                :disabled="field.connected"
              />
              {{ t('editorBridgeBinding.required') }}
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>{{ t('editorBridgeBinding.kind') }}</span>
              <select
                v-model="field.kind"
                class="h-10 rounded-lg border-none bg-tertiary-background px-3 text-sm text-base-foreground focus-visible:ring-1 focus-visible:ring-border-default focus-visible:outline-none disabled:opacity-50"
                :disabled="field.connected"
                :aria-label="
                  t('editorBridgeBinding.kindFor', { field: field.name })
                "
              >
                <option value="">
                  {{ t('editorBridgeBinding.inferKind') }}
                </option>
                <option value="string">
                  {{ t('editorBridgeBinding.kindString') }}
                </option>
                <option value="image">
                  {{ t('editorBridgeBinding.kindImage') }}
                </option>
                <option value="mask">
                  {{ t('editorBridgeBinding.kindMask') }}
                </option>
                <option value="model">
                  {{ t('editorBridgeBinding.kindModel') }}
                </option>
                <option value="server_path">
                  {{ t('editorBridgeBinding.kindServerPath') }}
                </option>
              </select>
            </label>
          </div>

          <label
            v-if="field.kind === 'model'"
            class="flex flex-col gap-1 text-sm"
          >
            <span>{{ t('editorBridgeBinding.modelCategory') }}</span>
            <Input v-model="field.modelCategory" />
          </label>
          <label
            v-if="field.kind === 'server_path'"
            class="flex flex-col gap-1 text-sm"
          >
            <span>{{ t('editorBridgeBinding.serverPathRoot') }}</span>
            <Input v-model="field.serverPathRoot" />
          </label>
          <div v-if="field.kind === 'mask'" class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm">
              <span>{{ t('editorBridgeBinding.channelField') }}</span>
              <Input v-model="field.channelField" />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>{{ t('editorBridgeBinding.channelValue') }}</span>
              <Input v-model="field.channelValue" />
            </label>
          </div>

          <input
            :id="`editor-bridge-field-${index}`"
            type="hidden"
            :value="field.name"
          />
        </article>
      </div>
    </template>

    <p
      v-if="errorMessage"
      role="alert"
      class="m-0 rounded-lg bg-destructive-background p-3 text-sm text-base-foreground"
    >
      {{ errorMessage }}
    </p>

    <footer class="flex flex-wrap justify-between gap-3">
      <Button
        v-if="canRemove"
        variant="destructive-textonly"
        @click="removeBinding"
      >
        {{ t('editorBridgeBinding.remove') }}
      </Button>
      <span v-else />
      <div class="flex gap-2">
        <Button variant="secondary" @click="close">
          {{ t('g.cancel') }}
        </Button>
        <Button
          variant="primary"
          :disabled="
            !backendClass || Boolean(unsupportedReason) || !fieldStates.length
          "
          @click="save"
        >
          {{ t('g.save') }}
        </Button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { useDialogStore } from '@/stores/dialogStore'

import type {
  EditorBindingDialogDraft,
  EditorBindingField
} from './editorBridgeBindingFields'

type FieldHint = {
  kind: string
  required: boolean
  modelCategory: string
  serverPathRoot: string
  channelField: string
  channelValue: string
}

const {
  nodeTitle,
  backendClass,
  nodeId,
  fields,
  initialKey,
  initialLabel,
  initialFieldConfig,
  canRemove,
  unsupportedReason = '',
  onSave,
  onRemove
} = defineProps<{
  nodeTitle: string
  backendClass: string
  nodeId: string
  fields: EditorBindingField[]
  initialKey: string
  initialLabel: string
  initialFieldConfig: Record<string, Record<string, unknown>>
  canRemove: boolean
  unsupportedReason?: string
  onSave: (draft: EditorBindingDialogDraft) => string | null
  onRemove: () => void
}>()

const { t } = useI18n()
const endpointKey = ref(initialKey)
const endpointLabel = ref(initialLabel)
const errorMessage = ref('')
const fieldStates = ref(
  fields.map((field) => {
    const hint = initialFieldConfig[field.name] ?? {}
    return {
      ...field,
      kind: typeof hint.kind === 'string' ? hint.kind : '',
      required: hint.required_from_editor === true,
      modelCategory:
        typeof hint.model_category === 'string' ? hint.model_category : '',
      serverPathRoot:
        typeof hint.server_path_root === 'string' ? hint.server_path_root : '',
      channelField:
        typeof hint.channel_field === 'string' ? hint.channel_field : '',
      channelValue:
        typeof hint.channel_value === 'string' ? hint.channel_value : 'red'
    } satisfies EditorBindingField & FieldHint
  })
)

function close() {
  useDialogStore().closeDialog()
}

function fieldConfig() {
  return Object.fromEntries(
    fieldStates.value.flatMap((field) => {
      const hint: Record<string, unknown> = {}
      if (field.required) hint.required_from_editor = true
      if (field.kind) hint.kind = field.kind
      if (field.kind === 'model' && field.modelCategory) {
        hint.model_category = field.modelCategory.trim()
      }
      if (field.kind === 'server_path' && field.serverPathRoot) {
        hint.server_path_root = field.serverPathRoot.trim()
      }
      if (field.kind === 'mask' && field.channelField) {
        hint.channel_field = field.channelField.trim()
        hint.channel_value = field.channelValue.trim() || 'red'
      }
      return Object.keys(hint).length ? [[field.name, hint]] : []
    })
  )
}

function save() {
  const error = onSave({
    key: endpointKey.value,
    label: endpointLabel.value,
    fieldConfig: fieldConfig()
  })
  if (error) {
    errorMessage.value = error
    return
  }
  close()
}

function removeBinding() {
  onRemove()
  close()
}
</script>
