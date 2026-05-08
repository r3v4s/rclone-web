export type TransferExecutionMode = 'rc' | 'cli'
export type TransferMode = 'copy' | 'move' | 'sync'

export type TransferCommandLike = {
    mode: TransferMode
    source: string
    target: string
    args: string[]
    preview?: string
}

export type NativeTransferRequest = {
    endpoint: '/sync/copy' | '/sync/move' | '/sync/sync'
    body: Record<string, unknown>
}

type ValueParser = (value: string, flag: string) => unknown

const valueConfigFlags = new Map<string, [string, ValueParser]>([
    ['--backup-dir', ['BackupDir', parseString]],
    ['--buffer-size', ['BufferSize', parseSize]],
    ['--bwlimit', ['BwLimit', parseString]],
    ['--checkers', ['Checkers', parseInteger]],
    ['--contimeout', ['ConnectTimeout', parseDuration]],
    ['--cutoff-mode', ['CutoffMode', parseString]],
    ['--log-level', ['LogLevel', parseString]],
    ['--low-level-retries', ['LowLevelRetries', parseInteger]],
    ['--max-transfer', ['MaxTransfer', parseSize]],
    ['--multi-thread-cutoff', ['MultiThreadCutoff', parseSize]],
    ['--multi-thread-streams', ['MultiThreadStreams', parseInteger]],
    ['--retries', ['Retries', parseInteger]],
    ['--retries-sleep', ['RetriesInterval', parseDuration]],
    ['--stats-log-level', ['StatsLogLevel', parseString]],
    ['--suffix', ['Suffix', parseString]],
    ['--timeout', ['Timeout', parseDuration]],
    ['--tpslimit', ['TPSLimit', parseNumber]],
    ['--tpslimit-burst', ['TPSLimitBurst', parseInteger]],
    ['--transfers', ['Transfers', parseInteger]],
])

const booleanConfigFlags = new Map<string, [string, boolean]>([
    ['--checksum', ['CheckSum', true]],
    ['--dry-run', ['DryRun', true]],
    ['--fast-list', ['UseListR', true]],
    ['--ignore-checksum', ['IgnoreChecksum', true]],
    ['--ignore-existing', ['IgnoreExisting', true]],
    ['--ignore-size', ['IgnoreSize', true]],
    ['--ignore-times', ['IgnoreTimes', true]],
    ['--immutable', ['Immutable', true]],
    ['--links', ['Links', true]],
    ['--metadata', ['Metadata', true]],
    ['--no-check-dest', ['NoCheckDest', true]],
    ['--no-traverse', ['NoTraverse', true]],
    ['--size-only', ['SizeOnly', true]],
    ['--track-renames', ['TrackRenames', true]],
    ['--update', ['UpdateOlder', true]],
])

const valueFilterFlags = new Map<string, [string, ValueParser]>([
    ['--exclude', ['ExcludeRule', parseString]],
    ['--exclude-from', ['ExcludeFrom', parseString]],
    ['--files-from', ['FilesFrom', parseString]],
    ['--files-from-raw', ['FilesFromRaw', parseString]],
    ['--filter', ['FilterRule', parseString]],
    ['--filter-from', ['FilterFrom', parseString]],
    ['--include', ['IncludeRule', parseString]],
    ['--include-from', ['IncludeFrom', parseString]],
    ['--max-age', ['MaxAge', parseDuration]],
    ['--max-size', ['MaxSize', parseSize]],
    ['--min-age', ['MinAge', parseDuration]],
    ['--min-size', ['MinSize', parseSize]],
])

const booleanFilterFlags = new Map<string, [string, boolean]>([
    ['--delete-excluded', ['DeleteExcluded', true]],
    ['--ignore-case', ['IgnoreCase', true]],
])

const ignoredFlags = new Set(['--progress', '-P', '--stats'])
const joinableRuleFlags = new Set(['--filter', '--metadata-filter'])

export function normalizeExecutionMode(
    value: unknown,
    fallback: TransferExecutionMode = 'cli'
): TransferExecutionMode {
    return value === 'rc' || value === 'cli' ? value : fallback
}

export function buildNativeTransferRequest(command: TransferCommandLike): NativeTransferRequest {
    const endpoint = `/sync/${command.mode}` as NativeTransferRequest['endpoint']
    const parsed = parseRcCompatibleArgs(normalizeRcloneArgs(command.args.slice(2)))
    const body: Record<string, unknown> = {
        srcFs: command.source || command.args[0],
        dstFs: command.target || command.args[1],
        ...parsed.body,
        _async: true,
    }

    if (!body.srcFs || !body.dstFs) {
        throw new Error('RC native mode requires source and target paths.')
    }

    if (Object.keys(parsed.config).length > 0) {
        body._config = JSON.stringify(parsed.config)
    }

    if (Object.keys(parsed.filter).length > 0) {
        body._filter = JSON.stringify(parsed.filter)
    }

    if (parsed.unsupported.length > 0) {
        throw new Error(
            `RC native mode supports common config/filter flags only. Unsupported flags: ${[
                ...new Set(parsed.unsupported),
            ].join(', ')}. Use CLI Command mode for backend-specific or arbitrary options.`
        )
    }

    return { endpoint, body }
}

export function normalizeRcloneArgs(args: string[]) {
    const normalized: string[] = []

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index]
        const next = args[index + 1]
        const afterNext = args[index + 2]

        if (
            token &&
            joinableRuleFlags.has(splitFlagValue(token).flag) &&
            !token.includes('=') &&
            (next === '+' || next === '-') &&
            afterNext
        ) {
            normalized.push(token, `${next} ${afterNext}`)
            index += 2
            continue
        }

        if (token) {
            normalized.push(token)
        }
    }

    return normalized
}

function parseRcCompatibleArgs(args: string[]) {
    const config: Record<string, unknown> = {}
    const filter: Record<string, unknown> = {}
    const body: Record<string, unknown> = {}
    const unsupported: string[] = []

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index]
        if (!token) continue

        const { flag, value, hasInlineValue } = splitFlagValue(token)

        if (handleShortVerbosity(flag, config)) {
            continue
        }

        if (ignoredFlags.has(flag)) {
            if (flag === '--stats' && !hasInlineValue && args[index + 1]) {
                index += 1
            }
            continue
        }

        const configValue = valueConfigFlags.get(flag)
        if (configValue) {
            const next = readFlagValue({ flag, value, hasInlineValue, args, index })
            config[configValue[0]] = configValue[1](next.value, flag)
            index = next.index
            continue
        }

        const filterValue = valueFilterFlags.get(flag)
        if (filterValue) {
            const next = readFlagValue({ flag, value, hasInlineValue, args, index })
            appendFilterValue(filter, filterValue[0], filterValue[1](next.value, flag))
            index = next.index
            continue
        }

        const configBoolean = booleanConfigFlags.get(flag)
        if (configBoolean) {
            config[configBoolean[0]] = hasInlineValue ? parseBoolean(value, flag) : configBoolean[1]
            continue
        }

        const filterBoolean = booleanFilterFlags.get(flag)
        if (filterBoolean) {
            filter[filterBoolean[0]] = hasInlineValue ? parseBoolean(value, flag) : filterBoolean[1]
            continue
        }

        if (flag === '--create-empty-src-dirs') {
            body.createEmptySrcDirs = hasInlineValue ? parseBoolean(value, flag) : true
            continue
        }

        if (flag === '--delete-empty-src-dirs') {
            body.deleteEmptySrcDirs = hasInlineValue ? parseBoolean(value, flag) : true
            continue
        }

        unsupported.push(flag)
        if (
            !hasInlineValue &&
            args[index + 1] &&
            (joinableRuleFlags.has(flag) || !args[index + 1].startsWith('-'))
        ) {
            index += 1
        }
    }

    return { config, filter, body, unsupported }
}

function splitFlagValue(token: string) {
    const equalIndex = token.indexOf('=')
    if (equalIndex < 0) {
        return { flag: token, value: '', hasInlineValue: false }
    }

    return {
        flag: token.slice(0, equalIndex),
        value: token.slice(equalIndex + 1),
        hasInlineValue: true,
    }
}

function readFlagValue({
    flag,
    value,
    hasInlineValue,
    args,
    index,
}: {
    flag: string
    value: string
    hasInlineValue: boolean
    args: string[]
    index: number
}) {
    if (hasInlineValue) {
        return { value, index }
    }

    const next = args[index + 1]
    if (next === undefined) {
        throw new Error(`${flag} requires a value.`)
    }

    return { value: next, index: index + 1 }
}

function appendFilterValue(filter: Record<string, unknown>, key: string, value: unknown) {
    if (key === 'MinSize' || key === 'MaxSize' || key === 'MinAge' || key === 'MaxAge') {
        filter[key] = value
        return
    }

    const current = Array.isArray(filter[key]) ? filter[key] : []
    filter[key] = [...current, value]
}

function handleShortVerbosity(flag: string, config: Record<string, unknown>) {
    if (!/^-[vPq]+$/.test(flag)) {
        return false
    }

    const verboseCount = [...flag].filter((char) => char === 'v').length
    const quietCount = [...flag].filter((char) => char === 'q').length
    if (quietCount > 0) {
        config.LogLevel = 'ERROR'
    } else if (verboseCount > 1) {
        config.LogLevel = 'DEBUG'
    } else if (verboseCount === 1) {
        config.LogLevel = 'INFO'
    }
    return true
}

function parseString(value: string) {
    return value
}

function parseInteger(value: string, flag: string) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
        throw new Error(`${flag} must be a number.`)
    }
    return parsed
}

function parseNumber(value: string, flag: string) {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) {
        throw new Error(`${flag} must be a number.`)
    }
    return parsed
}

function parseBoolean(value: string, flag: string) {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
    throw new Error(`${flag} must be true or false.`)
}

function parseSize(value: string, flag: string) {
    const match = value.trim().match(/^([\d.]+)\s*([kmgtp]?)(?:i?b?)?$/i)
    if (!match) {
        throw new Error(`${flag} must be a size such as 100M or 1G.`)
    }

    const amount = Number.parseFloat(match[1])
    if (!Number.isFinite(amount)) {
        throw new Error(`${flag} must be a valid size.`)
    }

    const unit = match[2].toLowerCase()
    const power =
        unit === 'p'
            ? 5
            : unit === 't'
              ? 4
              : unit === 'g'
                ? 3
                : unit === 'm'
                  ? 2
                  : unit === 'k'
                    ? 1
                    : 0
    return Math.round(amount * 1024 ** power)
}

function parseDuration(value: string, flag: string) {
    const trimmed = value.trim()
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        return Math.round(Number.parseFloat(trimmed) * 1_000_000_000)
    }

    const unitToNs: Record<string, number> = {
        ns: 1,
        us: 1_000,
        µs: 1_000,
        ms: 1_000_000,
        s: 1_000_000_000,
        m: 60 * 1_000_000_000,
        h: 60 * 60 * 1_000_000_000,
        d: 24 * 60 * 60 * 1_000_000_000,
        w: 7 * 24 * 60 * 60 * 1_000_000_000,
        y: 365 * 24 * 60 * 60 * 1_000_000_000,
    }
    const matches = [...trimmed.matchAll(/([\d.]+)\s*(ns|us|µs|ms|s|m|h|d|w|y)/gi)]

    if (matches.length === 0 || matches.map((match) => match[0]).join('') !== trimmed) {
        throw new Error(`${flag} must be a duration such as 30s, 10m, or 1h.`)
    }

    return Math.round(
        matches.reduce((total, match) => {
            const amount = Number.parseFloat(match[1])
            const unit = match[2].toLowerCase()
            return total + amount * unitToNs[unit]
        }, 0)
    )
}
