import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { chromium } from '@playwright/test'

const comfyUrl = (process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(
  /\/+$/,
  ''
)
const workflowDirectory =
  process.env.COMFYUI_WORKFLOW_DIRECTORY ?? 'workflows/prod'
const staleCheck = process.env.COMFYUI_EDITOR_BRIDGE_STALE_CHECK !== '0'

function systemChrome() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (configured) return configured
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'win32'
        ? [
            `${process.env.PROGRAMFILES ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env['PROGRAMFILES(X86)'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
          ]
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const executablePath = systemChrome()
    if (!executablePath) throw error
    return chromium.launch({ headless: true, executablePath })
  }
}

async function responseText(response, label) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${text}`)
  }
  return text
}

async function compileWorkflow(page, workflowPath, frontendVersion) {
  return page.evaluate(
    async ({ workflowPath, frontendVersion }) => {
      const workflowResponse = await fetch(
        `/api/userdata/${encodeURIComponent(workflowPath)}`
      )
      if (!workflowResponse.ok) {
        throw new Error(
          `Workflow read failed (${workflowResponse.status}): ${await workflowResponse.text()}`
        )
      }
      const workflow = await workflowResponse.json()
      await window.app.loadGraphData(workflow, true, true)
      const compiled = await window.app.graphToPrompt()
      const bindings = compiled.workflow.nodes.flatMap((node) => {
        const metadata = node.properties?.comfyui_editor_bridge
        return metadata
          ? [
              {
                node_id: node.id,
                node_type: node.type,
                graph_scope: 'top_level',
                metadata
              }
            ]
          : []
      })
      const response = await fetch('/editor-bridge/v1/workflows/compiled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: workflowPath,
          output: compiled.output,
          bindings,
          frontend_version: frontendVersion
        })
      })
      const detail = await response.text()
      if (!response.ok) {
        throw new Error(
          `Compiled-sidecar save failed (${response.status}): ${detail}`
        )
      }
      return {
        output: compiled.output,
        bindings,
        sourceText: JSON.stringify(workflow)
      }
    },
    { workflowPath, frontendVersion }
  )
}

function validateCompiledGraph(prompt, objectInfo, workflowPath) {
  for (const [nodeId, node] of Object.entries(prompt)) {
    const definition = objectInfo[node.class_type]
    assert.ok(
      definition,
      `${workflowPath}: node ${nodeId} uses unavailable class ${node.class_type}`
    )
    for (const [field, value] of Object.entries(node.inputs ?? {})) {
      if (!Array.isArray(value)) continue
      assert.equal(
        value.length,
        2,
        `${workflowPath}: ${nodeId}.${field} has a malformed link`
      )
      const producer = prompt[String(value[0])]
      assert.ok(
        producer,
        `${workflowPath}: ${nodeId}.${field} links to missing node ${value[0]}`
      )
      const outputs = objectInfo[producer.class_type]?.output ?? []
      assert.ok(
        Number.isInteger(value[1]) &&
          value[1] >= 0 &&
          value[1] < outputs.length,
        `${workflowPath}: ${nodeId}.${field} links to missing output ${value[1]} on ${value[0]}`
      )
    }
  }
}

async function writeUserData(workflowPath, body) {
  const response = await fetch(
    `${comfyUrl}/api/userdata/${encodeURIComponent(workflowPath)}?overwrite=true&full_info=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }
  )
  await responseText(response, `Write ${workflowPath}`)
}

const browser = await launchBrowser()
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(comfyUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => window.app?.graph && typeof window.app.graphToPrompt === 'function',
    undefined,
    { timeout: 30_000 }
  )

  const capabilitiesResponse = await fetch(
    `${comfyUrl}/editor-bridge/v1/capabilities`
  )
  const capabilities = JSON.parse(
    await responseText(capabilitiesResponse, 'Bridge capabilities')
  )
  const frontendVersion =
    capabilities.native_compilation?.supported_frontend_versions?.at(-1)
  assert.ok(frontendVersion, 'Bridge advertises no supported frontend version')

  const listQuery = new URLSearchParams({
    dir: workflowDirectory,
    recurse: 'true',
    split: 'false'
  })
  const listedResponse = await fetch(
    `${comfyUrl}/api/userdata?${listQuery.toString()}`
  )
  const listed = JSON.parse(await responseText(listedResponse, 'Workflow list'))
  const workflowPaths = listed
    .filter((value) => value.toLowerCase().endsWith('.json'))
    .map((value) => `${workflowDirectory}/${value}`)
    .sort()
  assert.ok(workflowPaths.length, 'No production workflows were found')

  const objectInfoResponse = await fetch(`${comfyUrl}/object_info`)
  const objectInfo = JSON.parse(
    await responseText(objectInfoResponse, 'ComfyUI object_info')
  )
  const reports = []

  for (const workflowPath of workflowPaths) {
    const originalResponse = await fetch(
      `${comfyUrl}/api/userdata/${encodeURIComponent(workflowPath)}`
    )
    const originalBytes = Buffer.from(await originalResponse.arrayBuffer())
    const expectedHash = createHash('sha256')
      .update(originalBytes)
      .digest('hex')
    const compiled = await compileWorkflow(page, workflowPath, frontendVersion)
    assert.ok(
      compiled.bindings.length,
      `${workflowPath}: workflow has no editor bindings`
    )
    validateCompiledGraph(compiled.output, objectInfo, workflowPath)

    const query = new URLSearchParams({ path: workflowPath })
    const sidecarResponse = await fetch(
      `${comfyUrl}/editor-bridge/v1/workflows/compiled?${query.toString()}`
    )
    const sidecar = JSON.parse(
      await responseText(sidecarResponse, `Read sidecar ${workflowPath}`)
    )
    assert.deepStrictEqual(
      sidecar.prompt,
      compiled.output,
      `${workflowPath}: sidecar differs from graphToPrompt().output`
    )
    assert.equal(
      sidecar.workflow_sha256,
      expectedHash,
      `${workflowPath}: sidecar hash differs from persisted UI bytes`
    )
    reports.push({
      workflow: workflowPath,
      nodes: Object.keys(compiled.output).length,
      bindings: compiled.bindings.length,
      workflow_sha256: expectedHash
    })
  }

  if (staleCheck) {
    const workflowPath =
      workflowPaths.find((value) =>
        value.endsWith('/integration/editor_bridge_cpu_smoke.json')
      ) ?? workflowPaths[0]
    const originalResponse = await fetch(
      `${comfyUrl}/api/userdata/${encodeURIComponent(workflowPath)}`
    )
    const originalText = await responseText(
      originalResponse,
      `Read stale-check source ${workflowPath}`
    )
    const staleWorkflow = JSON.parse(originalText)
    staleWorkflow.revision = Number(staleWorkflow.revision ?? 0) + 1
    try {
      await writeUserData(workflowPath, JSON.stringify(staleWorkflow))
      const query = new URLSearchParams({ path: workflowPath })
      const staleResponse = await fetch(
        `${comfyUrl}/editor-bridge/v1/workflows/compiled?${query.toString()}`
      )
      assert.equal(
        staleResponse.status,
        409,
        `${workflowPath}: out-of-band mutation did not invalidate sidecar`
      )
    } finally {
      await writeUserData(workflowPath, originalText)
      await compileWorkflow(page, workflowPath, frontendVersion)
    }
  }

  assert.deepEqual(
    pageErrors,
    [],
    `Browser page errors: ${pageErrors.join('; ')}`
  )
  console.log(
    JSON.stringify(
      {
        comfy_url: comfyUrl,
        frontend_version: frontendVersion,
        workflows: reports,
        stale_sidecar_rejection: staleCheck ? 'passed' : 'skipped'
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
}
