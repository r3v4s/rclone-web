import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Connect } from 'vite'

type TransferMode = 'copy' | 'move' | 'sync'
type ScheduleKind = 'interval' | 'cron'
type IntervalUnit = 'minutes' | 'hours' | 'days' | 'weeks'
type RunStatus = 'running' | 'completed' | 'failed'

type RcloneConnection = {
    url: string
    user: string
    pass: string
}

type ScheduledCommand = {
    mode: TransferMode
    source: string
    target: string
    args: string[]
    preview: string
    origin: 'cli' | 'preset' | 'builder'
    presetId?: string
    presetName?: string
}

type TransferSchedule = {
    id: string
    name: string
    description: string
    command: ScheduledCommand
    scheduleKind: ScheduleKind
    intervalValue: number
    intervalUnit: IntervalUnit
    cronExpression: string
    enabled: boolean
    showLogs: boolean
    rc: RcloneConnection
    nextRunAt: string
    lastRunAt: string
    createdAt: string
    updatedAt: string
}

type ScheduleRun = {
    id: string
    scheduleId: string
    scheduleName: string
    commandPreview: string
    status: RunStatus
    jobid: number | null
    startedAt: string
    endedAt: string
    durationMs: number
    bytes: number
    totalBytes: number
    successCount: number
    failedCount: number
    errorText: string
    logs: string[]
}

type StatsSnapshot = {
    bytes: number
    totalBytes: number
    speed: number
    errors: number
    checks: number
    totalChecks: number
    lastError: string
}

type TransferredItem = {
    name?: string
    size?: number
    bytes?: number
    error?: string
    jobid?: number
}

type JobStatus = {
    finished?: boolean
    success?: boolean
    error?: string
    endTime?: string
    duration?: number
    output?: unknown
}

type DbRow = {
    id: string
    data: string
}

const DB_FILE = process.env.RCLONE_WEB_DB ?? path.resolve(process.cwd(), '.data/rclone-web.sqlite')
const schedulerTimers = new WeakMap<DatabaseSync, NodeJS.Timeout>()
const runningSchedules = new Set<string>()

export function createAppDataMiddleware(logger: {
    info(message: string): void
    error(message: string): void
}) {
    const db = openDb()
    startScheduler(db, logger)

    return async function appDataMiddleware(
        req: IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction
    ) {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (!url.pathname.startsWith('/api/')) {
            next()
            return
        }

        try {
            if (req.method === 'GET' && url.pathname === '/api/health') {
                sendJson(res, { ok: true, db: DB_FILE })
                return
            }

            if (url.pathname === '/api/presets') {
                if (req.method === 'GET') {
                    sendJson(res, listRecords(db, 'presets'))
                    return
                }

                if (req.method === 'POST') {
                    const body = await readJson(req)
                    const id = stringValue(body.id) || randomUUID()
                    const data = { ...body, id }
                    upsertRecord(db, 'presets', id, data)
                    sendJson(res, data, 201)
                    return
                }
            }

            const presetId = matchId(url.pathname, '/api/presets/')
            if (presetId) {
                if (req.method === 'PUT') {
                    const body = await readJson(req)
                    const data = { ...body, id: presetId }
                    upsertRecord(db, 'presets', presetId, data)
                    sendJson(res, data)
                    return
                }

                if (req.method === 'DELETE') {
                    deleteRecord(db, 'presets', presetId)
                    sendJson(res, { ok: true })
                    return
                }
            }

            if (url.pathname === '/api/transfer-history') {
                if (req.method === 'GET') {
                    sendJson(res, listRecords(db, 'transfer_history'))
                    return
                }

                if (req.method === 'POST') {
                    const body = await readJson(req)
                    const id = requiredString(body.id, 'id is required')
                    upsertRecord(db, 'transfer_history', id, body)
                    sendJson(res, body, 201)
                    return
                }
            }

            if (url.pathname === '/api/schedules') {
                if (req.method === 'GET') {
                    sendJson(res, listSchedules(db))
                    return
                }

                if (req.method === 'POST') {
                    const body = await readJson(req)
                    const schedule = normalizeSchedule(body)
                    saveSchedule(db, schedule)
                    sendJson(res, schedule, 201)
                    return
                }
            }

            const scheduleRun = matchRunPath(url.pathname)
            if (scheduleRun && req.method === 'POST') {
                const schedule = getSchedule(db, scheduleRun.id)
                if (!schedule) {
                    sendJson(res, { error: 'Schedule not found.' }, 404)
                    return
                }

                const run = startScheduleRun(db, schedule, logger)
                sendJson(res, run, 202)
                return
            }

            const scheduleId = matchId(url.pathname, '/api/schedules/')
            if (scheduleId) {
                if (req.method === 'PUT') {
                    const body = await readJson(req)
                    const schedule = normalizeSchedule({ ...body, id: scheduleId })
                    saveSchedule(db, schedule)
                    sendJson(res, schedule)
                    return
                }

                if (req.method === 'DELETE') {
                    deleteRecord(db, 'schedules', scheduleId)
                    sendJson(res, { ok: true })
                    return
                }
            }

            if (url.pathname === '/api/schedule-runs' && req.method === 'GET') {
                const scheduleIdFilter = url.searchParams.get('scheduleId') ?? ''
                const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10)
                sendJson(
                    res,
                    listScheduleRuns(db, scheduleIdFilter, Number.isFinite(limit) ? limit : 100)
                )
                return
            }

            sendJson(res, { error: 'Not found.' }, 404)
        } catch (error) {
            sendJson(
                res,
                { error: error instanceof Error ? error.message : 'Unknown server error.' },
                500
            )
        }
    }
}

function openDb() {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
    const db = new DatabaseSync(DB_FILE)
    db.exec(`
        create table if not exists presets (
            id text primary key,
            data text not null,
            updated_at text not null
        );
        create table if not exists transfer_history (
            id text primary key,
            data text not null,
            updated_at text not null
        );
        create table if not exists schedules (
            id text primary key,
            data text not null,
            enabled integer not null,
            next_run_at text not null,
            updated_at text not null
        );
        create table if not exists schedule_runs (
            id text primary key,
            schedule_id text not null,
            data text not null,
            started_at text not null,
            ended_at text not null
        );
        create index if not exists idx_schedules_due on schedules(enabled, next_run_at);
        create index if not exists idx_schedule_runs_schedule on schedule_runs(schedule_id, started_at);
    `)
    return db
}

function listRecords<T>(db: DatabaseSync, table: 'presets' | 'transfer_history') {
    const rows = db
        .prepare(`select id, data from ${table} order by updated_at desc`)
        .all() as DbRow[]
    return rows.map((row) => parseStored<T>(row.data)).filter(Boolean)
}

function upsertRecord(
    db: DatabaseSync,
    table: 'presets' | 'transfer_history',
    id: string,
    data: unknown
) {
    const updatedAt = getUpdatedAt(data)
    db.prepare(
        `insert into ${table} (id, data, updated_at) values (?, ?, ?)
        on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at`
    ).run(id, JSON.stringify(data), updatedAt)
}

function deleteRecord(db: DatabaseSync, table: 'presets' | 'schedules', id: string) {
    db.prepare(`delete from ${table} where id = ?`).run(id)
}

function listSchedules(db: DatabaseSync) {
    const rows = db
        .prepare('select id, data from schedules order by updated_at desc')
        .all() as DbRow[]
    return rows.map((row) => parseStored<TransferSchedule>(row.data)).filter(Boolean)
}

function getSchedule(db: DatabaseSync, id: string) {
    const row = db.prepare('select id, data from schedules where id = ?').get(id) as
        | DbRow
        | undefined
    return row ? parseStored<TransferSchedule>(row.data) : null
}

function saveSchedule(db: DatabaseSync, schedule: TransferSchedule) {
    db.prepare(
        `insert into schedules (id, data, enabled, next_run_at, updated_at) values (?, ?, ?, ?, ?)
        on conflict(id) do update set
            data = excluded.data,
            enabled = excluded.enabled,
            next_run_at = excluded.next_run_at,
            updated_at = excluded.updated_at`
    ).run(
        schedule.id,
        JSON.stringify(schedule),
        schedule.enabled ? 1 : 0,
        schedule.nextRunAt,
        schedule.updatedAt
    )
}

function listScheduleRuns(db: DatabaseSync, scheduleId: string, limit: number) {
    const normalizedLimit = Math.max(1, Math.min(300, limit))
    const rows = scheduleId
        ? (db
              .prepare(
                  'select id, data from schedule_runs where schedule_id = ? order by started_at desc limit ?'
              )
              .all(scheduleId, normalizedLimit) as DbRow[])
        : (db
              .prepare('select id, data from schedule_runs order by started_at desc limit ?')
              .all(normalizedLimit) as DbRow[])
    return rows.map((row) => parseStored<ScheduleRun>(row.data)).filter(Boolean)
}

function saveRun(db: DatabaseSync, run: ScheduleRun) {
    db.prepare(
        `insert into schedule_runs (id, schedule_id, data, started_at, ended_at) values (?, ?, ?, ?, ?)
        on conflict(id) do update set
            data = excluded.data,
            ended_at = excluded.ended_at`
    ).run(run.id, run.scheduleId, JSON.stringify(run), run.startedAt, run.endedAt)
}

function startScheduler(db: DatabaseSync, logger: { error(message: string): void }) {
    if (schedulerTimers.has(db)) {
        return
    }

    const timer = setInterval(() => {
        const now = new Date().toISOString()
        const rows = db
            .prepare(
                'select id, data from schedules where enabled = 1 and next_run_at <= ? order by next_run_at asc limit 10'
            )
            .all(now) as DbRow[]

        for (const row of rows) {
            const schedule = parseStored<TransferSchedule>(row.data)
            if (!schedule || runningSchedules.has(schedule.id)) {
                continue
            }

            startScheduleRun(db, schedule, logger)
        }
    }, 15_000)

    schedulerTimers.set(db, timer)
}

function startScheduleRun(
    db: DatabaseSync,
    schedule: TransferSchedule,
    logger: { error(message: string): void }
) {
    if (runningSchedules.has(schedule.id)) {
        throw new Error('Schedule is already running.')
    }

    runningSchedules.add(schedule.id)
    const startedAt = new Date().toISOString()
    const run: ScheduleRun = {
        id: randomUUID(),
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        commandPreview: schedule.command.preview,
        status: 'running',
        jobid: null,
        startedAt,
        endedAt: '',
        durationMs: 0,
        bytes: 0,
        totalBytes: 0,
        successCount: 0,
        failedCount: 0,
        errorText: '',
        logs: schedule.showLogs
            ? [`${formatLocalTime(startedAt)} schedule started`, schedule.command.preview]
            : [],
    }
    saveRun(db, run)

    void executeScheduleRun(db, schedule, run, logger).finally(() => {
        runningSchedules.delete(schedule.id)
    })

    return run
}

async function executeScheduleRun(
    db: DatabaseSync,
    schedule: TransferSchedule,
    run: ScheduleRun,
    logger: { error(message: string): void }
) {
    const startedMs = Date.now()

    try {
        const startResponse = await rcloneRequest<{ jobid?: number }>(
            schedule.rc,
            '/core/command',
            {
                command: schedule.command.mode,
                arg: schedule.command.args,
            },
            { _async: 'true' }
        )
        const jobid = Number(startResponse.jobid)

        if (!Number.isFinite(jobid)) {
            throw new Error('rclone did not return a background job id.')
        }

        run.jobid = jobid
        appendRunLog(schedule, run, `job/${jobid} started`)
        saveRun(db, run)

        let status = await fetchJobStatus(schedule.rc, jobid)
        let stats = emptyStats()
        let transferred: TransferredItem[] = []

        while (!status.finished) {
            await delay(2000)
            const snapshot = await fetchRunSnapshot(schedule.rc, jobid)
            status = snapshot.status
            stats = snapshot.stats
            transferred = snapshot.transferred
            updateRunMetrics(run, stats, transferred, startedMs)
            appendRunLog(
                schedule,
                run,
                `progress ${formatBytes(stats.bytes)} transferred, ${formatBytes(stats.speed)}/s`
            )
            saveRun(db, run)
        }

        const finalSnapshot = await fetchRunSnapshot(schedule.rc, jobid)
        status = finalSnapshot.status
        stats = finalSnapshot.stats
        transferred = finalSnapshot.transferred
        updateRunMetrics(run, stats, transferred, startedMs)
        applyOutputMetrics(run, status)
        run.status = isSuccessfulJob(status) ? 'completed' : 'failed'
        run.endedAt = status.endTime || new Date().toISOString()
        run.durationMs = getDurationMs(status, startedMs)
        run.errorText = getJobError(status) || stats.lastError || ''
        appendOutputLogs(schedule, run, status)
        appendRunLog(schedule, run, `job/${jobid} ${run.status}`)
        saveRun(db, run)
    } catch (error) {
        run.status = 'failed'
        run.endedAt = new Date().toISOString()
        run.durationMs = Date.now() - startedMs
        run.errorText = error instanceof Error ? error.message : 'Unknown schedule error.'
        appendRunLog(schedule, run, `failed ${run.errorText}`)
        saveRun(db, run)
        logger.error(`[scheduler] ${run.errorText}`)
    } finally {
        const latest = getSchedule(db, schedule.id)
        if (latest) {
            latest.lastRunAt = run.startedAt
            latest.nextRunAt = computeNextRun(latest, new Date())
            latest.updatedAt = new Date().toISOString()
            saveSchedule(db, latest)
        }
    }
}

async function fetchRunSnapshot(rc: RcloneConnection, jobid: number) {
    const group = `job/${jobid}`
    const [status, statsResponse, transferredResponse] = await Promise.all([
        fetchJobStatus(rc, jobid),
        rcloneRequest<unknown>(rc, '/core/stats', undefined, { group }).catch(() => emptyStats()),
        rcloneRequest<{ transferred?: TransferredItem[] }>(rc, '/core/transferred', undefined, {
            group,
        }).catch(() => ({ transferred: [] })),
    ])

    return {
        status,
        stats: normalizeStats(statsResponse),
        transferred: Array.isArray(transferredResponse.transferred)
            ? transferredResponse.transferred.filter(
                  (item) => item.jobid === undefined || item.jobid === jobid
              )
            : [],
    }
}

async function fetchJobStatus(rc: RcloneConnection, jobid: number) {
    try {
        return await rcloneRequest<JobStatus>(rc, '/job/status', undefined, {
            jobid: String(jobid),
        })
    } catch (error) {
        return {
            finished: true,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown job error.',
        } satisfies JobStatus
    }
}

async function rcloneRequest<T>(
    rc: RcloneConnection,
    endpoint: string,
    body?: unknown,
    query?: Record<string, string>
): Promise<T> {
    const url = new URL(endpoint.replace(/^\//, ''), rc.url.replace(/\/+$/, '') + '/')
    for (const [key, value] of Object.entries(query ?? {})) {
        url.searchParams.set(key, value)
    }

    const headers = {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(rc.user && rc.pass
            ? {
                  authorization: `Basic ${Buffer.from(`${rc.user}:${rc.pass}`).toString('base64')}`,
              }
            : {}),
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data = text ? (JSON.parse(text) as { error?: unknown }) : {}

    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
    }

    if (data.error) {
        throw new Error(String(data.error))
    }

    return data as T
}

function normalizeSchedule(value: unknown): TransferSchedule {
    const record = isRecord(value) ? value : {}
    const now = new Date().toISOString()
    const schedule = {
        id: stringValue(record.id) || randomUUID(),
        name: stringValue(record.name) || 'Scheduled transfer',
        description: stringValue(record.description),
        command: normalizeCommand(record.command),
        scheduleKind: record.scheduleKind === 'cron' ? 'cron' : 'interval',
        intervalValue: Math.max(1, numberValue(record.intervalValue, 60)),
        intervalUnit: normalizeIntervalUnit(record.intervalUnit),
        cronExpression: stringValue(record.cronExpression) || '*/30 * * * *',
        enabled: record.enabled !== false,
        showLogs: record.showLogs !== false,
        rc: normalizeRc(record.rc),
        nextRunAt: stringValue(record.nextRunAt),
        lastRunAt: stringValue(record.lastRunAt),
        createdAt: stringValue(record.createdAt) || now,
        updatedAt: now,
    } satisfies TransferSchedule

    schedule.nextRunAt = schedule.enabled ? computeNextRun(schedule, new Date()) : ''
    return schedule
}

function normalizeCommand(value: unknown): ScheduledCommand {
    const record = isRecord(value) ? value : {}
    const args = Array.isArray(record.args) ? record.args.map(String) : []
    const mode = record.mode === 'move' || record.mode === 'sync' ? record.mode : 'copy'
    const source = stringValue(record.source) || args[0] || ''
    const target = stringValue(record.target) || args[1] || ''
    const normalizedArgs = args.length >= 2 ? args : [source, target].filter(Boolean)

    if (!source || !target || normalizedArgs.length < 2) {
        throw new Error('Schedule command must include source and target.')
    }

    return {
        mode,
        source,
        target,
        args: normalizedArgs,
        preview: stringValue(record.preview) || ['rclone', mode, ...normalizedArgs].join(' '),
        origin:
            record.origin === 'preset' || record.origin === 'builder' || record.origin === 'cli'
                ? record.origin
                : 'builder',
        presetId: stringValue(record.presetId),
        presetName: stringValue(record.presetName),
    }
}

function normalizeRc(value: unknown): RcloneConnection {
    const record = isRecord(value) ? value : {}
    const url = stringValue(record.url)

    if (!url) {
        throw new Error('Rclone RC connection is required.')
    }

    return {
        url,
        user: stringValue(record.user),
        pass: stringValue(record.pass),
    }
}

function normalizeIntervalUnit(value: unknown): IntervalUnit {
    return value === 'hours' || value === 'days' || value === 'weeks' ? value : 'minutes'
}

function computeNextRun(schedule: TransferSchedule, from: Date) {
    if (!schedule.enabled) {
        return ''
    }

    if (schedule.scheduleKind === 'cron') {
        return nextCronRun(schedule.cronExpression, from).toISOString()
    }

    return new Date(
        from.getTime() + intervalToMs(schedule.intervalValue, schedule.intervalUnit)
    ).toISOString()
}

function intervalToMs(value: number, unit: IntervalUnit) {
    const minutes =
        unit === 'weeks'
            ? value * 7 * 24 * 60
            : unit === 'days'
              ? value * 24 * 60
              : unit === 'hours'
                ? value * 60
                : value
    return minutes * 60_000
}

function nextCronRun(expression: string, from: Date) {
    const fields = parseCron(expression)
    const cursor = new Date(from.getTime() + 60_000)
    cursor.setSeconds(0, 0)

    for (let index = 0; index < 527_040; index += 1) {
        if (matchesCron(cursor, fields)) {
            return cursor
        }
        cursor.setMinutes(cursor.getMinutes() + 1)
    }

    throw new Error('Cron expression did not produce a run within one year.')
}

function parseCron(expression: string) {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) {
        throw new Error('Cron expression must have five fields.')
    }

    return {
        minute: parseCronField(parts[0], 0, 59),
        hour: parseCronField(parts[1], 0, 23),
        dayOfMonth: parseCronField(parts[2], 1, 31),
        month: parseCronField(parts[3], 1, 12),
        dayOfWeek: parseCronField(parts[4], 0, 7),
    }
}

function parseCronField(value: string, min: number, max: number) {
    const allowed = new Set<number>()

    for (const part of value.split(',')) {
        const [rangePart, stepPart] = part.split('/')
        const step = Math.max(1, Number.parseInt(stepPart ?? '1', 10))
        const [startText, endText] =
            rangePart === '*' ? [String(min), String(max)] : rangePart.split('-')
        const start = Number.parseInt(startText, 10)
        const end = Number.parseInt(endText ?? startText, 10)

        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            start < min ||
            end > max ||
            start > end
        ) {
            throw new Error(`Invalid cron field: ${value}`)
        }

        for (let current = start; current <= end; current += step) {
            allowed.add(current === 7 && max === 7 ? 0 : current)
        }
    }

    return allowed
}

function matchesCron(date: Date, fields: ReturnType<typeof parseCron>) {
    return (
        fields.minute.has(date.getMinutes()) &&
        fields.hour.has(date.getHours()) &&
        fields.dayOfMonth.has(date.getDate()) &&
        fields.month.has(date.getMonth() + 1) &&
        fields.dayOfWeek.has(date.getDay())
    )
}

function updateRunMetrics(
    run: ScheduleRun,
    stats: StatsSnapshot,
    transferred: TransferredItem[],
    startedMs: number
) {
    const failedItems = transferred.filter((item) => stringValue(item.error))
    run.bytes = stats.bytes
    run.totalBytes = stats.totalBytes
    run.successCount = transferred.filter((item) => !stringValue(item.error)).length
    run.failedCount = Math.max(failedItems.length, stats.errors)
    run.durationMs = Date.now() - startedMs
}

function applyOutputMetrics(run: ScheduleRun, status: JobStatus) {
    const result = getOutputResult(status)
    if (!result) {
        return
    }

    const bytes = parseTransferredBytes(result)
    if (run.bytes === 0 && bytes > 0) {
        run.bytes = bytes
    }
    if (run.totalBytes === 0 && bytes > 0) {
        run.totalBytes = bytes
    }

    const count = parseTransferredCount(result)
    if (run.successCount === 0 && count > 0) {
        run.successCount = count
    }

    const errors = parseErrorCount(result)
    if (run.failedCount === 0 && errors > 0) {
        run.failedCount = errors
    }
}

function appendOutputLogs(schedule: TransferSchedule, run: ScheduleRun, status: JobStatus) {
    const result = getOutputResult(status)
    if (!result) {
        return
    }

    for (const line of result
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(-20)) {
        appendRunLog(schedule, run, line)
    }
}

function getOutputResult(status: JobStatus) {
    const output = status.output
    if (output && typeof output === 'object' && 'result' in output) {
        return stringValue((output as { result?: unknown }).result)
    }

    return ''
}

function parseTransferredBytes(value: string) {
    const match = value.match(/^Transferred:\s+([\d.,]+)\s+([A-Za-z]+)\s*\/\s*[\d.,]+\s+[A-Za-z]+/m)
    if (!match) {
        return 0
    }

    return parseSize(match[1], match[2])
}

function parseTransferredCount(value: string) {
    const matches = [...value.matchAll(/^Transferred:\s+(\d+)\s*\/\s*(\d+),/gm)]
    const match = matches.at(-1)
    return match ? Number.parseInt(match[1], 10) || 0 : 0
}

function parseErrorCount(value: string) {
    const match = value.match(/^Errors:\s+(\d+)/m)
    return match ? Number.parseInt(match[1], 10) || 0 : 0
}

function parseSize(amount: string, unit: string) {
    const number = Number.parseFloat(amount.replace(/,/g, ''))
    if (!Number.isFinite(number)) {
        return 0
    }

    const normalizedUnit = unit.toLowerCase()
    const power = normalizedUnit.startsWith('p')
        ? 5
        : normalizedUnit.startsWith('t')
          ? 4
          : normalizedUnit.startsWith('g')
            ? 3
            : normalizedUnit.startsWith('m')
              ? 2
              : normalizedUnit.startsWith('k')
                ? 1
                : 0

    return Math.round(number * 1024 ** power)
}

function normalizeStats(value: unknown): StatsSnapshot {
    const record = isRecord(value) ? value : {}
    return {
        bytes: numberValue(record.bytes, 0),
        totalBytes: numberValue(record.totalBytes, 0),
        speed: numberValue(record.speed, 0),
        errors: numberValue(record.errors, 0),
        checks: numberValue(record.checks, 0),
        totalChecks: numberValue(record.totalChecks, 0),
        lastError: stringValue(record.lastError),
    }
}

function emptyStats(): StatsSnapshot {
    return {
        bytes: 0,
        totalBytes: 0,
        speed: 0,
        errors: 0,
        checks: 0,
        totalChecks: 0,
        lastError: '',
    }
}

function isSuccessfulJob(status: JobStatus) {
    const output = status.output
    const outputError =
        output && typeof output === 'object' && 'error' in output
            ? Boolean((output as { error?: unknown }).error)
            : false

    return Boolean(status.success) && !status.error && !outputError
}

function getJobError(status: JobStatus) {
    if (status.error) return status.error

    const output = status.output
    if (output && typeof output === 'object' && 'result' in output) {
        const result = stringValue((output as { result?: unknown }).result)
        const hasError = Boolean((output as { error?: unknown }).error)
        if (hasError && result) return result
    }

    return ''
}

function getDurationMs(status: JobStatus, startedMs: number) {
    if (typeof status.duration === 'number' && Number.isFinite(status.duration)) {
        return Math.round(status.duration * 1000)
    }

    return Date.now() - startedMs
}

function appendRunLog(schedule: TransferSchedule, run: ScheduleRun, message: string) {
    if (!schedule.showLogs) {
        return
    }

    run.logs = [...run.logs, `${formatLocalTime(new Date().toISOString())} ${message}`].slice(-300)
}

function parseStored<T>(value: string): T | null {
    try {
        return JSON.parse(value) as T
    } catch {
        return null
    }
}

async function readJson(req: IncomingMessage) {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const raw = Buffer.concat(chunks).toString('utf8')
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(data))
}

function matchId(pathname: string, prefix: string) {
    if (!pathname.startsWith(prefix)) {
        return ''
    }

    const rest = pathname.slice(prefix.length)
    return rest && !rest.includes('/') ? decodeURIComponent(rest) : ''
}

function matchRunPath(pathname: string) {
    const match = pathname.match(/^\/api\/schedules\/([^/]+)\/run$/)
    return match ? { id: decodeURIComponent(match[1]) } : null
}

function getUpdatedAt(data: unknown) {
    return isRecord(data)
        ? stringValue(data.updatedAt) || new Date().toISOString()
        : new Date().toISOString()
}

function requiredString(value: unknown, message: string) {
    const text = stringValue(value)
    if (!text) {
        throw new Error(message)
    }
    return text
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object')
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatLocalTime(value: string) {
    return new Date(value).toLocaleString()
}

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    let size = value
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex += 1
    }

    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}
