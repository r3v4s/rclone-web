import type { PresetTransferMode, TransferPreset } from '@/lib/transfer-presets'

export type RcloneConnection = {
    url: string
    user: string
    pass: string
}

export type ScheduledCommand = {
    mode: PresetTransferMode
    source: string
    target: string
    args: string[]
    preview: string
    origin: 'cli' | 'preset' | 'builder'
    presetId?: string
    presetName?: string
}

export type ScheduleKind = 'interval' | 'cron'
export type IntervalUnit = 'minutes' | 'hours' | 'days' | 'weeks'
export type ScheduleRunStatus = 'running' | 'completed' | 'failed'

export type TransferSchedule = {
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

export type ScheduleRun = {
    id: string
    scheduleId: string
    scheduleName: string
    commandPreview: string
    status: ScheduleRunStatus
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

export async function fetchServerPresets() {
    return apiFetch<TransferPreset[]>('/api/presets')
}

export async function saveServerPreset(preset: TransferPreset) {
    return apiFetch<TransferPreset>(`/api/presets/${encodeURIComponent(preset.id)}`, {
        method: 'PUT',
        body: JSON.stringify(preset),
    })
}

export async function createServerPreset(preset: TransferPreset) {
    return apiFetch<TransferPreset>('/api/presets', {
        method: 'POST',
        body: JSON.stringify(preset),
    })
}

export async function deleteServerPreset(id: string) {
    return apiFetch<{ ok: boolean }>(`/api/presets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    })
}

export async function fetchTransferHistory<T>() {
    return apiFetch<T[]>('/api/transfer-history')
}

export async function upsertTransferHistory<T extends { id: string }>(record: T) {
    return apiFetch<T>('/api/transfer-history', {
        method: 'POST',
        body: JSON.stringify(record),
    })
}

export async function fetchSchedules() {
    return apiFetch<TransferSchedule[]>('/api/schedules')
}

export async function saveSchedule(schedule: TransferSchedule) {
    return apiFetch<TransferSchedule>(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: 'PUT',
        body: JSON.stringify(schedule),
    })
}

export async function createSchedule(schedule: TransferSchedule) {
    return apiFetch<TransferSchedule>('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(schedule),
    })
}

export async function deleteSchedule(id: string) {
    return apiFetch<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    })
}

export async function runScheduleNow(id: string) {
    return apiFetch<ScheduleRun>(`/api/schedules/${encodeURIComponent(id)}/run`, {
        method: 'POST',
    })
}

export async function fetchScheduleRuns(limit = 100, scheduleId = '') {
    const params = new URLSearchParams({ limit: String(limit) })
    if (scheduleId) {
        params.set('scheduleId', scheduleId)
    }
    return apiFetch<ScheduleRun[]>(`/api/schedule-runs?${params}`)
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...init?.headers,
        },
    })
    const text = await response.text()
    const data = text ? (JSON.parse(text) as { error?: string }) : {}

    if (!response.ok) {
        throw new Error(data.error || `${response.status} ${response.statusText}`)
    }

    if (data.error) {
        throw new Error(data.error)
    }

    return data as T
}
