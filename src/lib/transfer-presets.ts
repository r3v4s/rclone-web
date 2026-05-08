import {
    normalizeExecutionMode,
    normalizeRcloneArgs,
    type TransferExecutionMode,
} from '@/lib/transfer-runtime'

export type PresetTransferMode = 'copy' | 'move' | 'sync'

export type TransferPreset = {
    id: string
    name: string
    description: string
    mode: PresetTransferMode
    executionMode?: TransferExecutionMode
    source: string
    target: string
    args: string[]
    preview: string
    keepHistory: boolean
    retryAfterFinish: boolean
    createdAt: string
    updatedAt: string
}

export type TransferPresetDraft = Omit<TransferPreset, 'id' | 'createdAt' | 'updatedAt'>

export const TRANSFER_PRESETS_KEY = 'lite-transfer-presets'
export const TRANSFER_PRESET_LIMIT = 80

const TRANSFER_MODES = new Set<PresetTransferMode>(['copy', 'move', 'sync'])
const FLAGS_WITH_VALUES = new Set([
    '--backup-dir',
    '--bwlimit',
    '--checkers',
    '--compare-dest',
    '--config',
    '--contimeout',
    '--copy-dest',
    '--cutoff-mode',
    '--drive-chunk-size',
    '--drive-root-folder-id',
    '--drive-upload-cutoff',
    '--exclude',
    '--filter',
    '--header',
    '--include',
    '--log-level',
    '--low-level-retries',
    '--max-age',
    '--metadata-exclude',
    '--metadata-include',
    '--metadata-filter',
    '--min-age',
    '--multi-thread-cutoff',
    '--multi-thread-streams',
    '--onedrive-chunk-size',
    '--retries',
    '--s3-chunk-size',
    '--stats',
    '--stats-log-level',
    '--suffix',
    '--timeout',
    '--tpslimit',
    '--transfers',
])

export function buildPresetDraft({
    name,
    description,
    mode,
    executionMode = 'rc',
    source,
    target,
    manualFlags,
    keepHistory,
    retryAfterFinish,
}: {
    name: string
    description: string
    mode: PresetTransferMode
    executionMode?: TransferExecutionMode
    source: string
    target: string
    manualFlags: string
    keepHistory: boolean
    retryAfterFinish: boolean
}): TransferPresetDraft {
    const normalizedName = name.trim()
    const normalizedSource = source.trim()
    const normalizedTarget = target.trim()

    if (!normalizedName) {
        throw new Error('Preset name is required.')
    }

    if (!normalizedSource) {
        throw new Error('Source path is required.')
    }

    if (!normalizedTarget) {
        throw new Error('Target path is required.')
    }

    const args = normalizeRcloneArgs([
        normalizedSource,
        normalizedTarget,
        ...parseManualFlags(manualFlags),
    ])

    return {
        name: normalizedName,
        description: description.trim(),
        mode,
        executionMode,
        source: normalizedSource,
        target: normalizedTarget,
        args,
        preview: ['rclone', mode, ...args].map(quoteArg).join(' '),
        keepHistory,
        retryAfterFinish,
    }
}

export function createTransferPreset(draft: TransferPresetDraft, id?: string): TransferPreset {
    const now = new Date().toISOString()

    return {
        ...draft,
        id: id || createId(),
        createdAt: now,
        updatedAt: now,
    }
}

export function updateTransferPreset(current: TransferPreset, draft: TransferPresetDraft) {
    return {
        ...current,
        ...draft,
        updatedAt: new Date().toISOString(),
    } satisfies TransferPreset
}

export function loadTransferPresets(): TransferPreset[] {
    try {
        if (typeof localStorage === 'undefined') return []
        const raw = localStorage.getItem(TRANSFER_PRESETS_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed)
            ? parsed.filter(isTransferPreset).slice(0, TRANSFER_PRESET_LIMIT)
            : []
    } catch {
        return []
    }
}

export function saveTransferPresets(presets: TransferPreset[]) {
    if (typeof localStorage === 'undefined') return

    localStorage.setItem(
        TRANSFER_PRESETS_KEY,
        JSON.stringify(presets.filter(isTransferPreset).slice(0, TRANSFER_PRESET_LIMIT))
    )
}

export function parseRcloneCommandToDraft(commandLine: string): TransferPresetDraft {
    const tokens = parseShellArgs(commandLine.replace(/\\\r?\n/g, ' '))
    if (tokens.length === 0) {
        throw new Error('rclone command is required.')
    }

    const normalizedTokens = isRcloneBinary(tokens[0]) ? tokens.slice(1) : tokens
    const modeIndex = normalizedTokens.findIndex((token) => isTransferMode(token))
    if (modeIndex < 0) {
        throw new Error('Only rclone copy, move, and sync commands can be converted.')
    }

    const mode = normalizedTokens[modeIndex] as PresetTransferMode
    const prefixArgs = normalizedTokens.slice(0, modeIndex)
    const parsedArgs = splitCommandArgs(normalizedTokens.slice(modeIndex + 1))

    if (!parsedArgs) {
        throw new Error('Command must include source and target paths after the operation.')
    }

    const { source, target, optionArgs: commandOptionArgs } = parsedArgs
    const optionArgs = [...prefixArgs, ...commandOptionArgs]
    const draftName = `${mode} ${source} to ${target}`
    const args = normalizeRcloneArgs([source, target, ...optionArgs])

    return {
        name: draftName,
        description: '',
        mode,
        executionMode: 'cli',
        source,
        target,
        args,
        preview: ['rclone', mode, ...args].map(quoteArg).join(' '),
        keepHistory: true,
        retryAfterFinish: false,
    }
}

export function parseManualFlags(value: string) {
    return value.split('\n').flatMap((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return []
        const parts = parseShellArgs(trimmed)
        if (parts.length > 0 && !parts[0].startsWith('-')) {
            throw new Error('Manual option lines must start with a rclone flag.')
        }
        return parts
    })
}

export function formatManualFlags(args: string[]) {
    const lines: string[] = []
    const normalizedArgs = normalizeRcloneArgs(args)

    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const current = normalizedArgs[index]
        const next = normalizedArgs[index + 1]

        if (
            current?.startsWith('-') &&
            next &&
            !current.includes('=') &&
            (flagConsumesValue(current) || !next.startsWith('-'))
        ) {
            lines.push(`${quoteArg(current)} ${quoteArg(next)}`)
            index += 1
            continue
        }

        if (current) {
            lines.push(quoteArg(current))
        }
    }

    return lines.join('\n')
}

export function parseShellArgs(value: string) {
    const args: string[] = []
    let current = ''
    let quote: '"' | "'" | null = null
    let escaped = false

    for (const char of value) {
        if (escaped) {
            current += char
            escaped = false
            continue
        }

        if (char === '\\' && quote !== "'") {
            escaped = true
            continue
        }

        if ((char === '"' || char === "'") && (!quote || quote === char)) {
            quote = quote ? null : char
            continue
        }

        if (!quote && /\s/.test(char)) {
            if (current) {
                args.push(current)
                current = ''
            }
            continue
        }

        current += char
    }

    if (quote) {
        throw new Error('Command contains an unclosed quote.')
    }

    if (escaped) {
        current += '\\'
    }

    if (current) {
        args.push(current)
    }

    return args
}

export function quoteArg(value: string) {
    return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value)
}

export function buildPresetCli(preset: Pick<TransferPreset, 'mode' | 'args'>) {
    return ['rclone', preset.mode, ...normalizeRcloneArgs(preset.args)].map(quoteArg).join(' ')
}

export function getTransferExecutionMode(
    preset: Pick<TransferPreset, 'executionMode'> | null | undefined
) {
    return normalizeExecutionMode(preset?.executionMode, 'cli')
}

function isTransferMode(value: string): value is PresetTransferMode {
    return TRANSFER_MODES.has(value as PresetTransferMode)
}

function isRcloneBinary(value: string) {
    const binary = value.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
    return binary === 'rclone' || binary === 'rclone.exe'
}

function splitCommandArgs(args: string[]) {
    const optionArgs: string[] = []
    const positionalArgs: string[] = []

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index]

        if (!current) {
            continue
        }

        if (positionalArgs.length < 2 && current.startsWith('-')) {
            optionArgs.push(current)

            if (flagConsumesValue(current) && args[index + 1]) {
                optionArgs.push(args[index + 1])
                index += 1
            }

            continue
        }

        if (positionalArgs.length < 2) {
            positionalArgs.push(current)
            continue
        }

        optionArgs.push(current)
    }

    const [source, target] = positionalArgs
    if (!source || !target) {
        return null
    }

    return { source, target, optionArgs }
}

function flagConsumesValue(flag: string) {
    if (flag.includes('=')) {
        return false
    }

    return FLAGS_WITH_VALUES.has(flag)
}

function isTransferPreset(value: unknown): value is TransferPreset {
    return Boolean(
        value &&
            typeof value === 'object' &&
            'id' in value &&
            'name' in value &&
            'mode' in value &&
            'source' in value &&
            'target' in value &&
            'args' in value &&
            Array.isArray((value as { args?: unknown }).args)
    )
}

function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
