import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { useDialogStore } from '@/stores/dialogStore'

import EditorBridgeBindingDialog from './EditorBridgeBindingDialog.vue'

describe('EditorBridgeBindingDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('builds typed field hints without raw JSON editing', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => null)
    const closeSpy = vi.spyOn(useDialogStore(), 'closeDialog')
    render(EditorBridgeBindingDialog, {
      global: { plugins: [i18n] },
      props: {
        nodeTitle: 'Load Mask',
        backendClass: 'LoadImageMask',
        nodeId: '7',
        fields: [{ name: 'image', type: 'COMBO', connected: false }],
        initialKey: 'mask_01',
        initialLabel: '',
        initialFieldConfig: {},
        canRemove: false,
        onSave,
        onRemove: vi.fn()
      }
    })

    await user.click(
      screen.getByRole('checkbox', { name: /required from editor/i })
    )
    await user.selectOptions(
      screen.getByRole('combobox', {
        name: /editor value kind for image/i
      }),
      'mask'
    )
    await user.type(screen.getByLabelText(/mask channel field/i), 'channel')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith({
      key: 'mask_01',
      label: '',
      fieldConfig: {
        image: {
          required_from_editor: true,
          kind: 'mask',
          channel_field: 'channel',
          channel_value: 'red'
        }
      }
    })
    expect(closeSpy).toHaveBeenCalledOnce()
  })

  it('keeps the dialog open and shows duplicate-key feedback', async () => {
    const user = userEvent.setup()
    const closeSpy = vi.spyOn(useDialogStore(), 'closeDialog')
    render(EditorBridgeBindingDialog, {
      global: { plugins: [i18n] },
      props: {
        nodeTitle: 'Sampler',
        backendClass: 'KSampler',
        nodeId: '9',
        fields: [{ name: 'cfg', type: 'FLOAT', connected: false }],
        initialKey: 'generation_01',
        initialLabel: '',
        initialFieldConfig: {},
        canRemove: false,
        onSave: () => 'Endpoint key is already used by node 8.',
        onRemove: vi.fn()
      }
    })

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Endpoint key is already used by node 8.'
    )
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('explains unsupported subgraph bindings and only allows removal', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => null)
    const onRemove = vi.fn()
    render(EditorBridgeBindingDialog, {
      global: { plugins: [i18n] },
      props: {
        nodeTitle: 'Nested loader',
        backendClass: 'LoadImage',
        nodeId: '10',
        fields: [{ name: 'image', type: 'COMBO', connected: false }],
        initialKey: 'input_image',
        initialLabel: '',
        initialFieldConfig: {},
        canRemove: true,
        unsupportedReason: 'Move a loader adapter to the top-level workflow.',
        onSave,
        onRemove
      }
    })

    expect(screen.getByRole('alert')).toHaveTextContent('top-level workflow')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: /remove editor exposure/i })
    )
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })
})
