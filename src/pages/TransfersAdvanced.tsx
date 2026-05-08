import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    ArrowRightIcon,
    BookmarkIcon,
    CheckCircle2Icon,
    ClockIcon,
    CopyIcon,
    FilePenLineIcon,
    FileWarningIcon,
    FolderIcon,
    HardDriveIcon,
    HistoryIcon,
    ListRestartIcon,
    type LucideIcon,
    PauseIcon,
    PlayIcon,
    RefreshCwIcon,
    Settings2Icon,
    TerminalIcon,
    XCircleIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageContent } from '@/components/PageContent'
import { PageHeader } from '@/components/PageHeader'
import { PageWrapper } from '@/components/PageWrapper'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatBytes, formatDuration, formatTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import {
    createServerPreset,
    fetchServerPresets,
    fetchTransferHistory,
    upsertTransferHistory,
} from '@/lib/server-data'
import {
    getTransferExecutionMode,
    loadTransferPresets,
    TRANSFER_PRESETS_KEY,
    type TransferPreset,
} from '@/lib/transfer-presets'
import {
    buildNativeTransferRequest,
    normalizeRcloneArgs,
    type TransferExecutionMode,
} from '@/lib/transfer-runtime'
import { cn } from '@/lib/ui'
import rclone from '@/rclone/client'
import { fetchRemotesList } from '@/rclone/usage'

type PathKind = 'local' | 'remote'
type TransferMode = 'copy' | 'move' | 'sync'
type OptionsMenu = 'common' | 'manual'
type BrowseSide = 'source' | 'target'
type TransferStatus = 'running' | 'paused' | 'completed' | 'failed' | 'stopped'

type BrowseSession = {
    side: BrowseSide
    kind: PathKind
    remote: string
    path: string
} | null

type TransferOptions = {
    transfers: string
    checkers: string
    bandwidth: string
    retries: string
    lowLevelRetries: string
    cutoffMode: string
    skipHashCheck: boolean
    fastList: boolean
    createEmptyDirs: boolean
    dryRun: boolean
    showLogs: boolean
    keepHistory: boolean
    retryAfterFinish: boolean
}

type TransferCommand = {
    mode: TransferMode
    executionMode: TransferExecutionMode
    source: string
    target: string
    args: string[]
    preview: string
}

type FailedTransferFile = {
    path: string
    reason: string
    size: number
}

type TransferRecord = TransferCommand & {
    id: string
    jobid: number
    group: string
    status: TransferStatus
    startedAt: string
    endedAt?: string
    pausedAt?: string
    bytes: number
    totalBytes: number
    speed: number
    eta: number | null
    failedFiles: FailedTransferFile[]
    errorText: string
    keepHistory: boolean
    retryAfterFinish: boolean
    retryOf?: string
    presetId?: string
    presetName?: string
}

type JobStatusResponse = {
    finished: boolean
    duration: number
    endTime: string
    error: string
    id: number
    startTime: string
    success: boolean
    output?: unknown
    progress?: unknown
    group?: string
}

type CoreStatsTransfer = {
    name?: string
    bytes?: number
    size?: number
    speed?: number
    speedAvg?: number
    eta?: number
    percentage?: number
}

type CoreStatsChecking = {
    name?: string
    size?: number
}

type CoreStatsSnapshot = {
    bytes: number
    checks: number
    errors: number
    eta: number | null
    lastError: string
    speed: number
    totalBytes: number
    totalChecks: number
    totalTransfers: number
    transfers: number
    transferring: CoreStatsTransfer[]
    checking: CoreStatsChecking[]
}

type TransferredItem = {
    name?: string
    size?: number
    bytes?: number
    checked?: boolean
    what?: string
    timestamp?: number
    error?: string
    jobid?: number
}

type TransferSnapshot = {
    status: JobStatusResponse
    stats: CoreStatsSnapshot
    transferred: TransferredItem[]
    failedFiles: FailedTransferFile[]
}

type StartTransferInput =
    | { source: 'current' }
    | { source: 'record'; record: TransferRecord; retryOf?: string }
    | { source: 'preset'; preset: TransferPreset }

const TRANSFER_HISTORY_KEY = 'lite-advanced-transfer-history'
const HISTORY_LIMIT = 30

const defaultTransferOptions: TransferOptions = {
    transfers: '4',
    checkers: '8',
    bandwidth: '',
    retries: '3',
    lowLevelRetries: '10',
    cutoffMode: 'HARD',
    skipHashCheck: false,
    fastList: true,
    createEmptyDirs: true,
    dryRun: false,
    showLogs: true,
    keepHistory: true,
    retryAfterFinish: false,
}

const emptyStats: CoreStatsSnapshot = {
    bytes: 0,
    checks: 0,
    errors: 0,
    eta: null,
    lastError: '',
    speed: 0,
    totalBytes: 0,
    totalChecks: 0,
    totalTransfers: 0,
    transfers: 0,
    transferring: [],
    checking: [],
}

export function TransfersAdvancedPage() {
    const t = useT()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [sourceKind, setSourceKind] = useState<PathKind>('local')
    const [targetKind, setTargetKind] = useState<PathKind>('remote')
    const [sourceRemote, setSourceRemote] = useState('')
    const [targetRemote, setTargetRemote] = useState('')
    const [sourcePath, setSourcePath] = useState('/')
    const [targetPath, setTargetPath] = useState('')
    const [mode, setMode] = useState<TransferMode>('copy')
    const [executionMode, setExecutionMode] = useState<TransferExecutionMode>('rc')
    const [optionsMenu, setOptionsMenu] = useState<OptionsMenu>('common')
    const [transferOptions, setTransferOptions] = useState<TransferOptions>(defaultTransferOptions)
    const [manualFlags, setManualFlags] = useState(
        '--exclude "*.tmp"\n--max-age 30d\n--min-size 1M'
    )
    const [browseSession, setBrowseSession] = useState<BrowseSession>(null)
    const [history, setHistory] = useState<TransferRecord[]>([])
    const [activeTransfer, setActiveTransfer] = useState<TransferRecord | null>(null)

    const historyQuery = useQuery({
        queryKey: ['advanced-transfer-history'],
        queryFn: () => fetchTransferHistory<TransferRecord>(),
    })

    const presetsQuery = useQuery({
        queryKey: ['transfer-presets'],
        queryFn: fetchServerPresets,
    })

    const presets = presetsQuery.data ?? []

    useEffect(() => {
        if (!historyQuery.data) return
        setHistory(historyQuery.data.filter(isTransferRecord).slice(0, HISTORY_LIMIT))
    }, [historyQuery.data])

    useEffect(() => {
        if (activeTransfer) return
        const runningRecord = history.find(
            (record) => record.status === 'running' || record.status === 'paused'
        )
        if (runningRecord) {
            setActiveTransfer(runningRecord)
        }
    }, [activeTransfer, history])

    useEffect(() => {
        const localHistory = loadTransferHistory()
        const localPresets = loadTransferPresets()
        const migrations = [
            ...localHistory.map((record) => upsertTransferHistory(record)),
            ...localPresets.map((preset) => createServerPreset(preset)),
        ]

        if (migrations.length === 0) {
            return
        }

        Promise.allSettled(migrations).then(() => {
            localStorage.removeItem(TRANSFER_HISTORY_KEY)
            localStorage.removeItem(TRANSFER_PRESETS_KEY)
            queryClient.invalidateQueries({ queryKey: ['advanced-transfer-history'] })
            queryClient.invalidateQueries({ queryKey: ['transfer-presets'] })
        })
    }, [queryClient])

    const remotesQuery = useQuery({
        queryKey: ['transfers', 'advanced', 'remotes'],
        queryFn: fetchRemotesList,
    })

    const disksQuery = useQuery({
        queryKey: ['core', 'disks'],
        queryFn: async () => {
            const response = await rclone('/core/disks')
            return response.disks ?? []
        },
    })

    const remotes = remotesQuery.data ?? []
    const disks = disksQuery.data ?? []
    const remoteNames = useMemo(() => remotes.map((remote) => remote.name), [remotes])

    useEffect(() => {
        const firstRemote = remoteNames[0]
        if (!firstRemote) return

        if (!sourceRemote) {
            setSourceRemote(firstRemote)
        }

        if (!targetRemote) {
            setTargetRemote(firstRemote)
        }
    }, [remoteNames, sourceRemote, targetRemote])

    const resolvedSource = resolvePath(sourceKind, sourceRemote || remoteNames[0], sourcePath)
    const resolvedTarget = resolvePath(targetKind, targetRemote || remoteNames[0], targetPath)
    const commandPreview = useMemo(() => {
        try {
            return buildTransferCommand({
                mode,
                executionMode,
                sourceKind,
                sourceRemote,
                sourcePath,
                targetKind,
                targetRemote,
                targetPath,
                options: transferOptions,
                manualFlags,
            }).preview
        } catch (error) {
            return error instanceof Error ? error.message : t('common.unknownError')
        }
    }, [
        manualFlags,
        mode,
        executionMode,
        sourceKind,
        sourcePath,
        sourceRemote,
        targetKind,
        targetPath,
        targetRemote,
        transferOptions,
        t,
    ])

    const activeSnapshotQuery = useQuery({
        queryKey: ['transfers', 'advanced', 'snapshot', activeTransfer?.jobid],
        queryFn: () => fetchTransferSnapshot(activeTransfer!),
        enabled: Boolean(activeTransfer?.jobid && activeTransfer.status === 'running'),
        refetchInterval: activeTransfer?.status === 'running' ? 1500 : false,
    })

    const activeSnapshot = activeSnapshotQuery.data ?? null
    const liveStats = activeSnapshot?.stats ?? {
        ...emptyStats,
        bytes: activeTransfer?.bytes ?? 0,
        totalBytes: activeTransfer?.totalBytes ?? 0,
        speed: activeTransfer?.speed ?? 0,
        eta: activeTransfer?.eta ?? null,
    }
    const liveStatus = activeTransfer?.status ?? 'stopped'
    const liveProgress = getProgressPercent(liveStats, activeSnapshot?.status, activeTransfer)
    const liveFailedFiles = activeSnapshot?.failedFiles ?? activeTransfer?.failedFiles ?? []
    const liveLogs = buildLiveLogs(activeTransfer, activeSnapshot)

    useEffect(() => {
        if (!activeTransfer || activeTransfer.status !== 'running') return
        if (!activeSnapshot?.status.finished) return

        const nextStatus = isSuccessfulJob(activeSnapshot.status) ? 'completed' : 'failed'
        const nextRecord: TransferRecord = {
            ...activeTransfer,
            status: nextStatus,
            endedAt: activeSnapshot.status.endTime || new Date().toISOString(),
            bytes: activeSnapshot.stats.bytes,
            totalBytes: activeSnapshot.stats.totalBytes,
            speed: activeSnapshot.stats.speed,
            eta: activeSnapshot.stats.eta,
            failedFiles: activeSnapshot.failedFiles,
            errorText:
                getJobError(activeSnapshot.status) ||
                activeSnapshot.stats.lastError ||
                (nextStatus === 'failed' ? t('common.unknownError') : ''),
        }

        setActiveTransfer(nextRecord)
        upsertHistoryRecord(nextRecord, setHistory, queryClient)
        queryClient.invalidateQueries({ queryKey: ['jobs'] })

        if (nextStatus === 'completed') {
            toast.success(t('transfersAdv.completed'))
        } else {
            toast.error(nextRecord.errorText || t('transfersAdv.failed'))
        }
    }, [activeSnapshot, activeTransfer, queryClient, setHistory, t])

    const startMutation = useMutation({
        mutationFn: async (input: StartTransferInput) => {
            const command =
                input.source === 'record'
                    ? input.record
                    : input.source === 'preset'
                      ? presetToCommand(input.preset)
                      : buildTransferCommand({
                            mode,
                            executionMode,
                            sourceKind,
                            sourceRemote,
                            sourcePath,
                            targetKind,
                            targetRemote,
                            targetPath,
                            options: transferOptions,
                            manualFlags,
                        })

            const response = await startTransferCommand(command)
            const jobid = getJobId(response)
            const now = new Date().toISOString()

            return {
                id: `${Date.now()}-${jobid}`,
                jobid,
                group: `job/${jobid}`,
                status: 'running',
                mode: command.mode,
                executionMode: command.executionMode,
                source: command.source,
                target: command.target,
                args: command.args,
                preview: command.preview,
                startedAt: now,
                bytes: 0,
                totalBytes: 0,
                speed: 0,
                eta: null,
                failedFiles: [],
                errorText: '',
                keepHistory:
                    input.source === 'record'
                        ? input.record.keepHistory
                        : input.source === 'preset'
                          ? input.preset.keepHistory
                          : transferOptions.keepHistory,
                retryAfterFinish:
                    input.source === 'record'
                        ? input.record.retryAfterFinish
                        : input.source === 'preset'
                          ? input.preset.retryAfterFinish
                          : transferOptions.retryAfterFinish,
                retryOf: input.source === 'record' ? (input.retryOf ?? input.record.id) : undefined,
                presetId: input.source === 'preset' ? input.preset.id : undefined,
                presetName: input.source === 'preset' ? input.preset.name : undefined,
            } satisfies TransferRecord
        },
        onSuccess: (record) => {
            setActiveTransfer(record)
            upsertHistoryRecord(record, setHistory, queryClient)
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success(t('transfersAdv.startSuccess', { id: record.jobid }))
        },
        onError: (error) => {
            toast.error(
                t('transfersAdv.startError', {
                    message: error instanceof Error ? error.message : t('common.unknownError'),
                })
            )
        },
    })

    const stopMutation = useMutation({
        mutationFn: async ({
            record,
            status,
        }: {
            record: TransferRecord
            status: 'paused' | 'stopped'
        }) => {
            await rclone('/job/stop', {
                params: { query: { jobid: record.jobid } },
            })

            return {
                ...record,
                status,
                pausedAt: status === 'paused' ? new Date().toISOString() : record.pausedAt,
                endedAt: status === 'stopped' ? new Date().toISOString() : record.endedAt,
            } satisfies TransferRecord
        },
        onSuccess: (record) => {
            setActiveTransfer(record)
            upsertHistoryRecord(record, setHistory, queryClient)
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success(
                record.status === 'paused'
                    ? t('transfersAdv.pauseSuccess')
                    : t('transfersAdv.stopSuccess')
            )
        },
        onError: (error) => {
            toast.error(
                t('transfersAdv.stopError', {
                    message: error instanceof Error ? error.message : t('common.unknownError'),
                })
            )
        },
    })

    function updateTransferOption<K extends keyof TransferOptions>(
        key: K,
        value: TransferOptions[K]
    ) {
        setTransferOptions((current) => ({ ...current, [key]: value }))
    }

    function handleReset() {
        setSourceKind('local')
        setTargetKind('remote')
        setSourcePath('/')
        setTargetPath('')
        setMode('copy')
        setExecutionMode('rc')
        setTransferOptions(defaultTransferOptions)
        setManualFlags('')
    }

    function handlePauseOrResume() {
        if (!activeTransfer) return

        if (activeTransfer.status === 'paused') {
            startMutation.mutate({ source: 'record', record: activeTransfer })
            return
        }

        if (activeTransfer.status === 'running') {
            stopMutation.mutate({ record: activeTransfer, status: 'paused' })
        }
    }

    function handleStop() {
        if (!activeTransfer || activeTransfer.status !== 'running') return
        stopMutation.mutate({ record: activeTransfer, status: 'stopped' })
    }

    function handleRetry(record = activeTransfer) {
        if (!record) return
        startMutation.mutate({ source: 'record', record })
    }

    function handleRunPreset(preset: TransferPreset) {
        startMutation.mutate({ source: 'preset', preset })
    }

    function openPathBrowser(side: BrowseSide) {
        setBrowseSession(
            side === 'source'
                ? {
                      side,
                      kind: sourceKind,
                      remote: sourceRemote || remoteNames[0] || '',
                      path: sourcePath,
                  }
                : {
                      side,
                      kind: targetKind,
                      remote: targetRemote || remoteNames[0] || '',
                      path: targetPath,
                  }
        )
    }

    function handlePathSelect({
        side,
        kind,
        remote,
        path,
    }: {
        side: BrowseSide
        kind: PathKind
        remote: string
        path: string
    }) {
        if (side === 'source') {
            setSourceKind(kind)
            setSourceRemote(remote)
            setSourcePath(path)
        } else {
            setTargetKind(kind)
            setTargetRemote(remote)
            setTargetPath(path)
        }

        setBrowseSession(null)
    }

    return (
        <PageWrapper>
            <PageHeader
                title={t('transfersAdv.title')}
                description={t('transfersAdv.description')}
                actions={
                    <div className="flex items-center gap-2">
                        <Button size="lg" variant="outline" type="button" onClick={handleReset}>
                            {t('common.reset')}
                        </Button>
                        <Button
                            size="lg"
                            type="button"
                            disabled={startMutation.isPending}
                            onClick={() => startMutation.mutate({ source: 'current' })}
                        >
                            <PlayIcon />
                            {startMutation.isPending
                                ? t('transfersAdv.starting')
                                : t('transfersAdv.startTransfer')}
                        </Button>
                    </div>
                }
            />

            <PageContent>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t('transfersAdv.pathTitle')}</CardTitle>
                                <CardDescription>
                                    {t('transfersAdv.pathDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
                                    <PathPanel
                                        title={t('transfersAdv.source')}
                                        icon={FolderIcon}
                                        kind={sourceKind}
                                        setKind={setSourceKind}
                                        remote={sourceRemote}
                                        setRemote={setSourceRemote}
                                        path={sourcePath}
                                        setPath={setSourcePath}
                                        remotes={remotes}
                                        resolved={resolvedSource}
                                        localPlaceholder="/Users/dev/source"
                                        onBrowse={() => openPathBrowser('source')}
                                    />

                                    <div className="hidden items-center justify-center lg:flex">
                                        <span className="inline-flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground">
                                            <ArrowRightIcon className="size-4" />
                                        </span>
                                    </div>

                                    <PathPanel
                                        title={t('transfersAdv.target')}
                                        icon={HardDriveIcon}
                                        kind={targetKind}
                                        setKind={setTargetKind}
                                        remote={targetRemote}
                                        setRemote={setTargetRemote}
                                        path={targetPath}
                                        setPath={setTargetPath}
                                        remotes={remotes}
                                        resolved={resolvedTarget}
                                        localPlaceholder="/Users/dev/target"
                                        onBrowse={() => openPathBrowser('target')}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('transfersAdv.modeTitle')}</CardTitle>
                                <CardDescription>
                                    {t('transfersAdv.modeDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <ModeCard
                                        value="copy"
                                        active={mode === 'copy'}
                                        icon={CopyIcon}
                                        title={t('transfersAdv.copy')}
                                        description={t('transfersAdv.copyDescription')}
                                        onSelect={setMode}
                                    />
                                    <ModeCard
                                        value="move"
                                        active={mode === 'move'}
                                        icon={ArrowRightIcon}
                                        title={t('transfersAdv.move')}
                                        description={t('transfersAdv.moveDescription')}
                                        onSelect={setMode}
                                    />
                                    <ModeCard
                                        value="sync"
                                        active={mode === 'sync'}
                                        icon={RefreshCwIcon}
                                        title={t('transfersAdv.sync')}
                                        description={t('transfersAdv.syncDescription')}
                                        onSelect={setMode}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('transfersAdv.executionTitle')}</CardTitle>
                                <CardDescription>
                                    {t('transfersAdv.executionDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <ExecutionModeCard
                                        value="rc"
                                        active={executionMode === 'rc'}
                                        icon={RefreshCwIcon}
                                        title={t('transfersAdv.executionRc')}
                                        description={t('transfersAdv.executionRcDescription')}
                                        onSelect={setExecutionMode}
                                    />
                                    <ExecutionModeCard
                                        value="cli"
                                        active={executionMode === 'cli'}
                                        icon={TerminalIcon}
                                        title={t('transfersAdv.executionCli')}
                                        description={t('transfersAdv.executionCliDescription')}
                                        onSelect={setExecutionMode}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transfersAdv.optionsTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transfersAdv.optionsDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <div className="inline-flex rounded-lg border bg-background p-0.5">
                                        <MenuButton
                                            active={optionsMenu === 'common'}
                                            onClick={() => setOptionsMenu('common')}
                                        >
                                            <Settings2Icon className="size-3.5" />
                                            {t('transfersAdv.commonOptions')}
                                        </MenuButton>
                                        <MenuButton
                                            active={optionsMenu === 'manual'}
                                            onClick={() => setOptionsMenu('manual')}
                                        >
                                            <TerminalIcon className="size-3.5" />
                                            {t('transfersAdv.manualOptions')}
                                        </MenuButton>
                                    </div>
                                </CardAction>
                            </CardHeader>
                            <CardContent>
                                {optionsMenu === 'common' ? (
                                    <CommonOptions
                                        options={transferOptions}
                                        onChange={updateTransferOption}
                                    />
                                ) : (
                                    <ManualOptions
                                        value={manualFlags}
                                        onChange={setManualFlags}
                                        commandPreview={commandPreview}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transfersAdv.presetsTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transfersAdv.presetsDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => navigate('/transfer-presets')}
                                    >
                                        <FilePenLineIcon />
                                        {t('transfersAdv.managePresets')}
                                    </Button>
                                </CardAction>
                            </CardHeader>
                            <CardContent>
                                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                                    {presets.length === 0 ? (
                                        <div className="rounded-lg border px-3 py-8 text-center">
                                            <div className="text-sm text-muted-foreground">
                                                {t('transfersAdv.noPresets')}
                                            </div>
                                            <Button
                                                type="button"
                                                className="mt-3"
                                                variant="outline"
                                                onClick={() => navigate('/transfer-presets')}
                                            >
                                                <BookmarkIcon />
                                                {t('transfersAdv.createPreset')}
                                            </Button>
                                        </div>
                                    ) : null}
                                    {presets.map((preset) => (
                                        <div
                                            key={preset.id}
                                            className="grid gap-3 rounded-lg border px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <BookmarkIcon className="size-4 text-primary" />
                                                    <span className="truncate text-sm font-medium">
                                                        {preset.name}
                                                    </span>
                                                    <Badge variant="outline">
                                                        {formatExecutionMode(
                                                            getTransferExecutionMode(preset)
                                                        )}
                                                    </Badge>
                                                </div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                                    {preset.mode} {preset.source} to {preset.target}
                                                </div>
                                                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                                    {preset.preview}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={startMutation.isPending}
                                                onClick={() => handleRunPreset(preset)}
                                            >
                                                <PlayIcon />
                                                {t('transfersAdv.runPreset')}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transfersAdv.liveTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transfersAdv.liveDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <HistoryStatus status={liveStatus} />
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Metric
                                        label={t('transfersAdv.transferred')}
                                        value={
                                            liveStats.totalBytes > 0
                                                ? `${formatBytes(liveStats.bytes)} / ${formatBytes(liveStats.totalBytes)}`
                                                : formatBytes(liveStats.bytes)
                                        }
                                    />
                                    <Metric
                                        label={t('transfersAdv.speed')}
                                        value={`${formatBytes(liveStats.speed)}/s`}
                                    />
                                    <Metric
                                        label={t('transfersAdv.eta')}
                                        value={liveStats.eta ? formatDuration(liveStats.eta) : '-'}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="font-medium">
                                            {t('transfersAdv.jobProgress')}
                                        </span>
                                        <span className="text-muted-foreground tabular-nums">
                                            {liveProgress}%
                                        </span>
                                    </div>
                                    <Progress value={liveProgress} />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={
                                            !activeTransfer ||
                                            (activeTransfer.status !== 'running' &&
                                                activeTransfer.status !== 'paused') ||
                                            stopMutation.isPending ||
                                            startMutation.isPending
                                        }
                                        onClick={handlePauseOrResume}
                                    >
                                        {activeTransfer?.status === 'paused' ? (
                                            <PlayIcon />
                                        ) : (
                                            <PauseIcon />
                                        )}
                                        {activeTransfer?.status === 'paused'
                                            ? t('transfersAdv.resume')
                                            : t('transfersAdv.pause')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={
                                            !activeTransfer ||
                                            liveFailedFiles.length === 0 ||
                                            startMutation.isPending
                                        }
                                        onClick={() => handleRetry()}
                                    >
                                        <ListRestartIcon />
                                        {t('transfersAdv.retryFailed')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        disabled={
                                            !activeTransfer ||
                                            activeTransfer.status !== 'running' ||
                                            stopMutation.isPending
                                        }
                                        onClick={handleStop}
                                    >
                                        <XCircleIcon />
                                        {t('common.stop')}
                                    </Button>
                                </div>

                                <div className="rounded-xl border bg-muted/30">
                                    <div className="flex items-center justify-between border-b px-3 py-2">
                                        <span className="text-sm font-medium">
                                            {t('transfersAdv.liveLogs')}
                                        </span>
                                        <ClockIcon className="size-4 text-muted-foreground" />
                                    </div>
                                    <div className="max-h-56 overflow-auto p-3 font-mono text-xs leading-5">
                                        {liveLogs.map((line) => (
                                            <div
                                                key={line}
                                                className="whitespace-pre-wrap break-all text-muted-foreground"
                                            >
                                                {line}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('transfersAdv.failedFiles')}</CardTitle>
                                <CardDescription>
                                    {t('transfersAdv.failedFilesDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {liveFailedFiles.length === 0 ? (
                                        <div className="rounded-lg border px-3 py-8 text-center text-sm text-muted-foreground">
                                            {t('transfersAdv.noFailedFiles')}
                                        </div>
                                    ) : null}
                                    {liveFailedFiles.map((file) => (
                                        <div
                                            key={file.path}
                                            className="grid gap-3 rounded-lg border px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center"
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">
                                                    {file.path}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {file.reason} / {formatBytes(file.size)}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={
                                                    !activeTransfer || startMutation.isPending
                                                }
                                                onClick={() => handleRetry()}
                                            >
                                                <ListRestartIcon />
                                                {t('transfersAdv.retry')}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transfersAdv.historyTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transfersAdv.historyDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <HistoryIcon className="size-4 text-muted-foreground" />
                                </CardAction>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-hidden rounded-xl border">
                                    <Table className="min-w-[760px]">
                                        <TableHeader className="bg-muted/40">
                                            <TableRow>
                                                <TableHead>{t('transfersAdv.job')}</TableHead>
                                                <TableHead>{t('transfersAdv.status')}</TableHead>
                                                <TableHead>{t('transfersAdv.route')}</TableHead>
                                                <TableHead>{t('transfersAdv.size')}</TableHead>
                                                <TableHead>{t('common.actions')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {history.length === 0 ? (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={5}
                                                        className="py-8 text-center text-muted-foreground"
                                                    >
                                                        {t('transfersAdv.emptyHistory')}
                                                    </TableCell>
                                                </TableRow>
                                            ) : null}
                                            {history.map((row) => (
                                                <TableRow key={row.id}>
                                                    <TableCell className="font-mono tabular-nums">
                                                        #{row.jobid}
                                                    </TableCell>
                                                    <TableCell>
                                                        <HistoryStatus status={row.status} />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="max-w-[300px] space-y-1">
                                                            <div className="truncate text-sm">
                                                                {row.source}
                                                            </div>
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {row.mode} to {row.target}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {formatTime(row.startedAt)}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{formatTransferSize(row)}</TableCell>
                                                    <TableCell>
                                                        {row.failedFiles.length > 0 ||
                                                        row.status === 'failed' ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={startMutation.isPending}
                                                                onClick={() => handleRetry(row)}
                                                            >
                                                                <ListRestartIcon />
                                                                {t('transfersAdv.retryFailed')}
                                                            </Button>
                                                        ) : null}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </PageContent>

            <PathBrowserDialog
                session={browseSession}
                remotes={remotes}
                disks={disks}
                onClose={() => setBrowseSession(null)}
                onSelect={handlePathSelect}
            />
        </PageWrapper>
    )
}

function PathPanel({
    title,
    icon: Icon,
    kind,
    setKind,
    remote,
    setRemote,
    path,
    setPath,
    remotes,
    resolved,
    localPlaceholder,
    onBrowse,
}: {
    title: string
    icon: LucideIcon
    kind: PathKind
    setKind: (value: PathKind) => void
    remote: string
    setRemote: (value: string) => void
    path: string
    setPath: (value: string) => void
    remotes: Array<{ name: string; type: string }>
    resolved: string
    localPlaceholder: string
    onBrowse: () => void
}) {
    const t = useT()
    const remoteSelectItems = remotes.map((item) => ({ label: item.name, value: item.name }))

    return (
        <div className="rounded-xl border bg-background p-4">
            <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                </span>
                <h2 className="text-base font-medium">{title}</h2>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
                <PathKindButton
                    active={kind === 'local'}
                    icon={HardDriveIcon}
                    label={t('transfersAdv.local')}
                    onClick={() => setKind('local')}
                />
                <PathKindButton
                    active={kind === 'remote'}
                    icon={FolderIcon}
                    label={t('transfersAdv.remote')}
                    onClick={() => setKind('remote')}
                />
            </div>

            <FieldGroup className="gap-4">
                {kind === 'remote' ? (
                    <Field>
                        <FieldLabel>{t('common.remote')}</FieldLabel>
                        <Select
                            items={remoteSelectItems}
                            value={remote}
                            onValueChange={(value) => setRemote(value ?? '')}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {remotes.map((item) => (
                                        <SelectItem key={item.name} value={item.name}>
                                            <span>{item.name}</span>
                                            <span className="text-muted-foreground">
                                                {item.type}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                ) : null}

                <Field>
                    <FieldLabel>{t('transfersAdv.path')}</FieldLabel>
                    <div className="flex gap-2">
                        <Input
                            value={path}
                            onChange={(event) => setPath(event.target.value)}
                            placeholder={kind === 'local' ? localPlaceholder : '/folder/path'}
                        />
                        <Button type="button" variant="outline" onClick={onBrowse}>
                            <FolderIcon />
                            {t('transfersAdv.browse')}
                        </Button>
                    </div>
                </Field>

                <Field>
                    <FieldDescription className="rounded-lg bg-muted px-2.5 py-2 font-mono text-xs break-all">
                        {resolved}
                    </FieldDescription>
                </Field>
            </FieldGroup>
        </div>
    )
}

function PathKindButton({
    active,
    icon: Icon,
    label,
    onClick,
}: {
    active: boolean
    icon: LucideIcon
    label: string
    onClick: () => void
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
                active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
        >
            <Icon className="size-4" />
            {label}
        </button>
    )
}

function ModeCard({
    value,
    active,
    icon: Icon,
    title,
    description,
    onSelect,
}: {
    value: TransferMode
    active: boolean
    icon: LucideIcon
    title: string
    description: string
    onSelect: (value: TransferMode) => void
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(value)}
            className={cn(
                'min-h-32 rounded-xl border p-4 text-left transition-colors',
                active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background hover:bg-muted/60'
            )}
        >
            <Icon className="mb-4 size-5" />
            <div className="text-base font-medium">{title}</div>
            <div
                className={cn('mt-1 text-sm', active ? 'text-primary/80' : 'text-muted-foreground')}
            >
                {description}
            </div>
        </button>
    )
}

function ExecutionModeCard({
    value,
    active,
    icon: Icon,
    title,
    description,
    onSelect,
}: {
    value: TransferExecutionMode
    active: boolean
    icon: LucideIcon
    title: string
    description: string
    onSelect: (value: TransferExecutionMode) => void
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(value)}
            className={cn(
                'min-h-28 rounded-xl border p-4 text-left transition-colors',
                active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background hover:bg-muted/60'
            )}
        >
            <Icon className="mb-3 size-5" />
            <div className="text-base font-medium">{title}</div>
            <div
                className={cn('mt-1 text-sm', active ? 'text-primary/80' : 'text-muted-foreground')}
            >
                {description}
            </div>
        </button>
    )
}

function MenuButton({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
            )}
        >
            {children}
        </button>
    )
}

function CommonOptions({
    options,
    onChange,
}: {
    options: TransferOptions
    onChange: <K extends keyof TransferOptions>(key: K, value: TransferOptions[K]) => void
}) {
    const t = useT()

    return (
        <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-3">
                <Field>
                    <FieldLabel>{t('transfersAdv.transfers')}</FieldLabel>
                    <Input
                        type="number"
                        min={1}
                        value={options.transfers}
                        onChange={(event) => onChange('transfers', event.target.value)}
                    />
                </Field>
                <Field>
                    <FieldLabel>{t('transfersAdv.checkers')}</FieldLabel>
                    <Input
                        type="number"
                        min={1}
                        value={options.checkers}
                        onChange={(event) => onChange('checkers', event.target.value)}
                    />
                </Field>
                <Field>
                    <FieldLabel>{t('transfersAdv.bandwidth')}</FieldLabel>
                    <Input
                        value={options.bandwidth}
                        onChange={(event) => onChange('bandwidth', event.target.value)}
                        placeholder="off, 10M or 1M:100k"
                    />
                </Field>
                <Field>
                    <FieldLabel>{t('transfersAdv.retries')}</FieldLabel>
                    <Input
                        type="number"
                        min={0}
                        value={options.retries}
                        onChange={(event) => onChange('retries', event.target.value)}
                    />
                </Field>
                <Field>
                    <FieldLabel>{t('transfersAdv.lowLevelRetries')}</FieldLabel>
                    <Input
                        type="number"
                        min={0}
                        value={options.lowLevelRetries}
                        onChange={(event) => onChange('lowLevelRetries', event.target.value)}
                    />
                </Field>
                <Field>
                    <FieldLabel>{t('transfersAdv.cutoffMode')}</FieldLabel>
                    <Input
                        value={options.cutoffMode}
                        onChange={(event) => onChange('cutoffMode', event.target.value)}
                    />
                </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <ToggleOption
                    title={t('transfersAdv.skipHashCheck')}
                    description={t('transfersAdv.skipHashCheckDescription')}
                    checked={options.skipHashCheck}
                    onCheckedChange={(checked) => onChange('skipHashCheck', checked)}
                />
                <ToggleOption
                    title={t('transfersAdv.fastList')}
                    description={t('transfersAdv.fastListDescription')}
                    checked={options.fastList}
                    onCheckedChange={(checked) => onChange('fastList', checked)}
                />
                <ToggleOption
                    title={t('transfersAdv.createEmptyDirs')}
                    description={t('transfersAdv.createEmptyDirsDescription')}
                    checked={options.createEmptyDirs}
                    onCheckedChange={(checked) => onChange('createEmptyDirs', checked)}
                />
                <ToggleOption
                    title={t('transfersAdv.dryRun')}
                    description={t('transfersAdv.dryRunDescription')}
                    checked={options.dryRun}
                    onCheckedChange={(checked) => onChange('dryRun', checked)}
                />
            </div>

            <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={options.showLogs}
                        onCheckedChange={(checked) => onChange('showLogs', Boolean(checked))}
                    />
                    {t('transfersAdv.showLogs')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={options.keepHistory}
                        onCheckedChange={(checked) => onChange('keepHistory', Boolean(checked))}
                    />
                    {t('transfersAdv.keepHistory')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={options.retryAfterFinish}
                        onCheckedChange={(checked) =>
                            onChange('retryAfterFinish', Boolean(checked))
                        }
                    />
                    {t('transfersAdv.retryAfterFinish')}
                </label>
            </div>
        </div>
    )
}

function ToggleOption({
    title,
    description,
    checked,
    onCheckedChange,
}: {
    title: string
    description: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
            <div className="space-y-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    )
}

function ManualOptions({
    value,
    onChange,
    commandPreview,
}: {
    value: string
    onChange: (value: string) => void
    commandPreview: string
}) {
    const t = useT()

    return (
        <div className="space-y-4">
            <Field>
                <FieldLabel>{t('transfersAdv.manualFlags')}</FieldLabel>
                <Textarea
                    className="min-h-36 font-mono"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    spellCheck={false}
                />
                <FieldDescription>{t('transfersAdv.manualFlagsDescription')}</FieldDescription>
            </Field>

            <div className="rounded-xl border bg-muted/40 p-3">
                <div className="mb-2 text-sm font-medium">{t('transfersAdv.commandPreview')}</div>
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted-foreground">
                    {commandPreview}
                </pre>
            </div>
        </div>
    )
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border bg-background p-3">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        </div>
    )
}

function HistoryStatus({ status }: { status: TransferStatus }) {
    const t = useT()
    const ui = {
        running: {
            icon: RefreshCwIcon,
            label: t('transfersAdv.running'),
            className: 'bg-emerald-500/15 text-emerald-600',
        },
        paused: {
            icon: PauseIcon,
            label: t('transfersAdv.paused'),
            className: 'bg-amber-500/15 text-amber-600',
        },
        failed: {
            icon: FileWarningIcon,
            label: t('transfersAdv.failed'),
            className: 'bg-destructive/15 text-destructive',
        },
        completed: {
            icon: CheckCircle2Icon,
            label: t('transfersAdv.completed'),
            className: 'bg-sky-500/15 text-sky-600',
        },
        stopped: {
            icon: XCircleIcon,
            label: t('transfersAdv.stopped'),
            className: 'bg-muted text-muted-foreground',
        },
    }[status]
    const Icon = ui.icon

    return (
        <Badge variant="secondary" className={cn('gap-1.5', ui.className)}>
            <Icon className={cn(status === 'running' && 'animate-spin')} />
            {ui.label}
        </Badge>
    )
}

function PathBrowserDialog({
    session,
    remotes,
    disks,
    onClose,
    onSelect,
}: {
    session: BrowseSession
    remotes: Array<{ name: string; type: string }>
    disks: string[]
    onClose: () => void
    onSelect: (selection: {
        side: BrowseSide
        kind: PathKind
        remote: string
        path: string
    }) => void
}) {
    const t = useT()
    const [browseRemote, setBrowseRemote] = useState('')
    const [localFs, setLocalFs] = useState('/')
    const [currentPath, setCurrentPath] = useState('')

    const remoteSelectItems = remotes.map((remote) => ({ label: remote.name, value: remote.name }))
    const localRoots = useMemo(() => {
        const roots = disks.length > 0 ? disks : ['/']
        return [...new Set(roots.map(normalizeLocalRoot))].sort((a, b) => a.localeCompare(b))
    }, [disks])

    useEffect(() => {
        if (!session) return

        if (session.kind === 'local') {
            const location = getLocalBrowseLocation(session.path, localRoots)
            setLocalFs(location.fs)
            setCurrentPath(location.path)
            return
        }

        setBrowseRemote(session.remote || remotes[0]?.name || '')
        setCurrentPath(normalizeRemoteBrowsePath(session.path))
    }, [localRoots, remotes, session])

    const currentFs = session?.kind === 'local' ? localFs : `${browseRemote}:`
    const canBrowse = Boolean(session && currentFs && (session.kind === 'local' || browseRemote))

    const directoriesQuery = useQuery({
        queryKey: ['transfers', 'advanced', 'browse', session?.kind, currentFs, currentPath],
        queryFn: async ({ signal }) => {
            const response = await rclone('/operations/list', {
                params: { query: { fs: currentFs, remote: currentPath } },
                signal,
            })

            return (response.list ?? [])
                .map((item, index) => {
                    const name = String(item.Name ?? '')
                    const path = String(item.Path ?? name)
                    const isDir = Boolean(item.IsDir || item.IsBucket)

                    return {
                        rowKey: JSON.stringify([currentFs, currentPath, path, name, index]),
                        name,
                        path,
                        isDir,
                    }
                })
                .filter((item) => item.isDir && item.name)
                .sort((a, b) => a.name.localeCompare(b.name))
        },
        enabled: canBrowse,
    })

    if (!session) {
        return null
    }

    const isLocal = session.kind === 'local'
    const currentLocation = isLocal
        ? joinLocalFsPath(localFs, currentPath)
        : `${browseRemote}:${currentPath}`
    const pathSegments = currentPath.split('/').filter(Boolean)
    const parentPath = pathSegments.slice(0, -1).join('/')

    function handleSelectCurrent() {
        onSelect({
            side: session!.side,
            kind: session!.kind,
            remote: isLocal ? '' : browseRemote,
            path: isLocal ? joinLocalFsPath(localFs, currentPath) : formatRemotePath(currentPath),
        })
    }

    return (
        <Dialog open={Boolean(session)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="border-b p-4 pr-12">
                    <DialogTitle>{t('transfersAdv.folderBrowser')}</DialogTitle>
                    <DialogDescription>
                        {t('transfersAdv.folderBrowserDescription')}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid max-h-[calc(100dvh-12rem)] gap-4 overflow-y-auto p-4">
                    {isLocal ? (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">
                                {t('transfersAdv.localRoots')}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {localRoots.map((root) => {
                                    const normalizedRoot = ensureLocalFs(root)
                                    return (
                                        <Button
                                            key={root}
                                            type="button"
                                            size="sm"
                                            variant={
                                                localFs === normalizedRoot ? 'default' : 'outline'
                                            }
                                            onClick={() => {
                                                setLocalFs(normalizedRoot)
                                                setCurrentPath('')
                                            }}
                                        >
                                            <HardDriveIcon />
                                            {root}
                                        </Button>
                                    )
                                })}
                            </div>
                        </div>
                    ) : (
                        <Field>
                            <FieldLabel>{t('common.remote')}</FieldLabel>
                            <Select
                                items={remoteSelectItems}
                                value={browseRemote}
                                onValueChange={(value) => {
                                    setBrowseRemote(value ?? '')
                                    setCurrentPath('')
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {remotes.map((remote) => (
                                            <SelectItem key={remote.name} value={remote.name}>
                                                <span>{remote.name}</span>
                                                <span className="text-muted-foreground">
                                                    {remote.type}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    )}

                    <div className="space-y-2">
                        <div className="text-sm font-medium">
                            {t('transfersAdv.currentLocation')}
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">
                            {currentLocation}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1.5 text-sm">
                        <button
                            type="button"
                            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setCurrentPath('')}
                        >
                            {isLocal ? joinLocalFsPath(localFs, '') : `${browseRemote}:`}
                        </button>
                        {pathSegments.map((segment, index) => (
                            <span key={`${segment}:${index}`} className="flex items-center gap-1">
                                <ArrowRightIcon className="size-3 text-muted-foreground" />
                                <button
                                    type="button"
                                    className="rounded-md px-2 py-1 hover:bg-muted"
                                    onClick={() =>
                                        setCurrentPath(pathSegments.slice(0, index + 1).join('/'))
                                    }
                                >
                                    {segment}
                                </button>
                            </span>
                        ))}
                    </div>

                    <div className="overflow-hidden rounded-xl border">
                        <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                            <span className="text-sm font-medium">
                                {t('transfersAdv.directories')}
                            </span>
                            {directoriesQuery.isFetching ? (
                                <RefreshCwIcon className="size-4 animate-spin text-muted-foreground" />
                            ) : null}
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {currentPath ? (
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                                    onClick={() => setCurrentPath(parentPath)}
                                >
                                    <ArrowRightIcon className="size-4 rotate-180 text-muted-foreground" />
                                    {t('transfersAdv.parentFolder')}
                                </button>
                            ) : null}

                            {!canBrowse ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    {t('transfersAdv.noDirectories')}
                                </div>
                            ) : null}

                            {canBrowse && directoriesQuery.isPending ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    {t('common.loading')}
                                </div>
                            ) : null}

                            {canBrowse && directoriesQuery.isError ? (
                                <div className="space-y-3 px-3 py-8 text-center">
                                    <div className="text-sm text-destructive">
                                        {directoriesQuery.error instanceof Error
                                            ? directoriesQuery.error.message
                                            : t('common.unknownError')}
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => directoriesQuery.refetch()}
                                    >
                                        {t('common.retry')}
                                    </Button>
                                </div>
                            ) : null}

                            {canBrowse &&
                            directoriesQuery.isSuccess &&
                            directoriesQuery.data.length === 0 ? (
                                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    {t('transfersAdv.noDirectories')}
                                </div>
                            ) : null}

                            {canBrowse &&
                                directoriesQuery.data?.map((directory) => (
                                    <button
                                        key={directory.rowKey}
                                        type="button"
                                        className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/60"
                                        onClick={() => setCurrentPath(directory.path)}
                                    >
                                        <FolderIcon className="size-4 text-primary" />
                                        <span className="min-w-0 flex-1 truncate">
                                            {directory.name}
                                        </span>
                                        <ArrowRightIcon className="size-4 text-muted-foreground" />
                                    </button>
                                ))}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button type="button" onClick={handleSelectCurrent}>
                        <CheckCircle2Icon />
                        {t('transfersAdv.selectThisFolder')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

async function fetchTransferSnapshot(record: TransferRecord): Promise<TransferSnapshot> {
    const [status, statsResponse, transferredResponse] = await Promise.all([
        rclone('/job/status', {
            params: { query: { jobid: record.jobid } },
        }) as Promise<JobStatusResponse>,
        rclone('/core/stats', {
            params: { query: { group: record.group } },
        }).catch(() => emptyStats),
        rclone('/core/transferred', {
            params: { query: { group: record.group } },
        }).catch(() => ({ transferred: [] })),
    ])

    const stats = normalizeStats(statsResponse)
    const transferred = Array.isArray(transferredResponse.transferred)
        ? (transferredResponse.transferred as TransferredItem[])
        : []

    return {
        status,
        stats,
        transferred,
        failedFiles: getFailedFiles(transferred, record.jobid),
    }
}

function buildTransferCommand({
    mode,
    executionMode,
    sourceKind,
    sourceRemote,
    sourcePath,
    targetKind,
    targetRemote,
    targetPath,
    options,
    manualFlags,
}: {
    mode: TransferMode
    executionMode: TransferExecutionMode
    sourceKind: PathKind
    sourceRemote: string
    sourcePath: string
    targetKind: PathKind
    targetRemote: string
    targetPath: string
    options: TransferOptions
    manualFlags: string
}): TransferCommand {
    if (sourceKind === 'remote' && !sourceRemote.trim()) {
        throw new Error('Source remote is required.')
    }

    if (targetKind === 'remote' && !targetRemote.trim()) {
        throw new Error('Target remote is required.')
    }

    const source = resolvePath(sourceKind, sourceRemote, sourcePath)
    const target = resolvePath(targetKind, targetRemote, targetPath)
    const args = normalizeRcloneArgs([
        source,
        target,
        ...buildCommonOptionArgs(options),
        ...parseManualFlags(manualFlags),
    ])

    return {
        mode,
        executionMode,
        source,
        target,
        args,
        preview: ['rclone', mode, ...args].map(quoteArg).join(' '),
    }
}

function presetToCommand(preset: TransferPreset): TransferCommand {
    return {
        mode: preset.mode,
        executionMode: getTransferExecutionMode(preset),
        source: preset.source,
        target: preset.target,
        args: preset.args,
        preview: preset.preview,
    }
}

async function startTransferCommand(command: TransferCommand) {
    if (command.executionMode === 'rc') {
        const request = buildNativeTransferRequest(command)
        return await rclone(request.endpoint, { body: request.body })
    }

    return await rclone('/core/command', {
        params: { query: { _async: true } },
        body: {
            command: command.mode,
            arg: normalizeRcloneArgs(command.args),
        },
    })
}

function buildCommonOptionArgs(options: TransferOptions) {
    const args: string[] = []
    appendNumberFlag(args, '--transfers', options.transfers, 1)
    appendNumberFlag(args, '--checkers', options.checkers, 1)
    appendNumberFlag(args, '--retries', options.retries, 0)
    appendNumberFlag(args, '--low-level-retries', options.lowLevelRetries, 0)

    const bandwidth = options.bandwidth.trim()
    if (bandwidth) {
        args.push('--bwlimit', bandwidth)
    }

    const cutoffMode = options.cutoffMode.trim()
    if (cutoffMode) {
        args.push('--cutoff-mode', cutoffMode)
    }

    if (options.skipHashCheck) args.push('--ignore-checksum')
    if (options.fastList) args.push('--fast-list')
    if (options.createEmptyDirs) args.push('--create-empty-src-dirs')
    if (options.dryRun) args.push('--dry-run')
    if (options.showLogs) args.push('--stats', '1s', '--log-level', 'INFO')

    return args
}

function appendNumberFlag(args: string[], flag: string, value: string, minimum: number) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < minimum) return
    args.push(flag, String(parsed))
}

function parseManualFlags(value: string) {
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

function parseShellArgs(value: string) {
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
        throw new Error('Manual options contain an unclosed quote.')
    }

    if (escaped) {
        current += '\\'
    }

    if (current) {
        args.push(current)
    }

    return args
}

function quoteArg(value: string) {
    return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value)
}

function getJobId(response: unknown) {
    const jobid =
        response && typeof response === 'object' && 'jobid' in response
            ? Number((response as { jobid?: unknown }).jobid)
            : Number.NaN

    if (!Number.isFinite(jobid)) {
        throw new Error('rclone did not return a background job id.')
    }

    return jobid
}

function normalizeStats(value: unknown): CoreStatsSnapshot {
    const stats = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

    return {
        bytes: numberValue(stats.bytes),
        checks: numberValue(stats.checks),
        errors: numberValue(stats.errors),
        eta: typeof stats.eta === 'number' && Number.isFinite(stats.eta) ? stats.eta : null,
        lastError: stringValue(stats.lastError),
        speed: numberValue(stats.speed),
        totalBytes: numberValue(stats.totalBytes),
        totalChecks: numberValue(stats.totalChecks),
        totalTransfers: numberValue(stats.totalTransfers),
        transfers: numberValue(stats.transfers),
        transferring: Array.isArray(stats.transferring)
            ? (stats.transferring as CoreStatsTransfer[])
            : [],
        checking: Array.isArray(stats.checking) ? (stats.checking as CoreStatsChecking[]) : [],
    }
}

function numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
}

function getFailedFiles(transferred: TransferredItem[], jobid: number) {
    return transferred
        .filter((item) => item.jobid === undefined || item.jobid === jobid)
        .filter((item) => stringValue(item.error))
        .map((item) => ({
            path: stringValue(item.name) || 'unknown',
            reason: stringValue(item.error),
            size: numberValue(item.size || item.bytes),
        }))
}

function isSuccessfulJob(status: JobStatusResponse) {
    const output = status.output
    const outputError =
        output && typeof output === 'object' && 'error' in output
            ? Boolean((output as { error?: unknown }).error)
            : false

    return status.success && !status.error && !outputError
}

function getJobError(status: JobStatusResponse) {
    if (status.error) return status.error

    const output = status.output
    if (output && typeof output === 'object' && 'result' in output) {
        const result = stringValue((output as { result?: unknown }).result)
        const hasError = Boolean((output as { error?: unknown }).error)
        if (hasError && result) return result
    }

    return ''
}

function getProgressPercent(
    stats: CoreStatsSnapshot,
    status?: JobStatusResponse,
    record?: TransferRecord | null
) {
    if (status?.finished && isSuccessfulJob(status)) return 100
    if (record?.status === 'completed') return 100
    if (stats.totalBytes > 0) {
        return Math.max(0, Math.min(100, Math.round((stats.bytes / stats.totalBytes) * 100)))
    }
    return 0
}

function buildLiveLogs(record: TransferRecord | null, snapshot: TransferSnapshot | null) {
    if (!record) {
        return ['No active transfer.']
    }

    const lines = [
        `${formatTime(record.startedAt)} job/${record.jobid}: ${record.mode} started`,
        `execution: ${formatExecutionMode(record.executionMode)}`,
        `source: ${record.source}`,
        `target: ${record.target}`,
    ]

    if (record.presetName) {
        lines.push(`preset: ${record.presetName}`)
    }

    if (record.status === 'paused') {
        lines.push(`${formatTime(record.pausedAt ?? '')} job/${record.jobid}: paused by user`)
    }

    if (record.status === 'stopped') {
        lines.push(`${formatTime(record.endedAt ?? '')} job/${record.jobid}: stopped by user`)
    }

    if (!snapshot) {
        return lines
    }

    lines.push(
        `progress: ${formatBytes(snapshot.stats.bytes)} transferred, ${formatBytes(snapshot.stats.speed)}/s, checks ${snapshot.stats.checks}/${snapshot.stats.totalChecks}`
    )

    for (const item of snapshot.stats.transferring.slice(0, 6)) {
        lines.push(
            `transferring: ${item.name ?? 'unknown'} ${Math.round(numberValue(item.percentage))}% ${formatBytes(numberValue(item.bytes))}/${formatBytes(numberValue(item.size))}`
        )
    }

    for (const item of snapshot.transferred.slice(-6)) {
        const error = stringValue(item.error)
        lines.push(
            error
                ? `failed: ${item.name ?? 'unknown'} ${error}`
                : `done: ${item.name ?? 'unknown'} ${formatBytes(numberValue(item.bytes || item.size))}`
        )
    }

    if (snapshot.stats.lastError) {
        lines.push(`last error: ${snapshot.stats.lastError}`)
    }

    if (snapshot.status.finished) {
        lines.push(
            `${formatTime(snapshot.status.endTime)} job/${record.jobid}: ${
                isSuccessfulJob(snapshot.status) ? 'completed' : 'failed'
            }`
        )
    }

    return lines
}

function loadTransferHistory(): TransferRecord[] {
    try {
        const raw = localStorage.getItem(TRANSFER_HISTORY_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(isTransferRecord).slice(0, HISTORY_LIMIT) : []
    } catch {
        return []
    }
}

function isTransferRecord(value: unknown): value is TransferRecord {
    return Boolean(
        value &&
            typeof value === 'object' &&
            'id' in value &&
            'jobid' in value &&
            'mode' in value &&
            'source' in value &&
            'target' in value &&
            'args' in value
    )
}

function upsertHistoryRecord(
    record: TransferRecord,
    setHistory: React.Dispatch<React.SetStateAction<TransferRecord[]>>,
    queryClient?: QueryClient
) {
    if (!record.keepHistory) return

    setHistory((current) => {
        const next = [record, ...current.filter((item) => item.id !== record.id)].slice(
            0,
            HISTORY_LIMIT
        )
        queryClient?.setQueryData(['advanced-transfer-history'], next)
        return next
    })

    void upsertTransferHistory(record)
        .then(() => {
            queryClient?.invalidateQueries({ queryKey: ['advanced-transfer-history'] })
        })
        .catch(() => {})
}

function formatTransferSize(record: TransferRecord) {
    if (record.totalBytes > 0) {
        return `${formatBytes(record.bytes)} / ${formatBytes(record.totalBytes)}`
    }
    return formatBytes(record.bytes)
}

function formatExecutionMode(mode: TransferExecutionMode) {
    return mode === 'rc' ? 'RC native' : 'CLI'
}

function resolvePath(kind: PathKind, remote: string | undefined, path: string) {
    const trimmedPath = path.trim()

    if (kind === 'local') {
        return trimmedPath || '/'
    }

    const normalizedRemote = remote?.trim() || ''
    const normalizedPath = trimmedPath.replace(/^\/+/, '')
    return `${normalizedRemote}:${normalizedPath}`
}

function normalizeRemoteBrowsePath(path: string) {
    const trimmed = path.trim()
    const withoutRemote = trimmed.includes(':') ? trimmed.slice(trimmed.indexOf(':') + 1) : trimmed
    return withoutRemote.replace(/^\/+|\/+$/g, '')
}

function formatRemotePath(path: string) {
    return path ? `/${path.replace(/^\/+/, '')}` : ''
}

function normalizeLocalRoot(path: string) {
    const trimmed = path.trim().replace(/\\/g, '/')
    if (!trimmed || trimmed === '/') return '/'
    return trimmed.replace(/\/+$/g, '')
}

function ensureLocalFs(path: string) {
    const root = normalizeLocalRoot(path)
    return root === '/' ? '/' : `${root}/`
}

function normalizeLocalPath(path: string) {
    const trimmed = path.trim().replace(/\\/g, '/')
    if (!trimmed) return '/'
    return trimmed.startsWith('/') ? trimmed.replace(/\/+$/g, '') || '/' : `/${trimmed}`
}

function getLocalBrowseLocation(path: string, roots: string[]) {
    const normalizedPath = normalizeLocalPath(path)
    const normalizedRoots = [...new Set([...roots, '/'].map(normalizeLocalRoot))].sort(
        (a, b) => b.length - a.length
    )
    const root =
        normalizedRoots.find(
            (candidate) =>
                normalizedPath === candidate ||
                (candidate !== '/' && normalizedPath.startsWith(`${candidate}/`))
        ) ?? '/'

    const relativePath =
        root === '/'
            ? normalizedPath.replace(/^\/+/, '')
            : normalizedPath.slice(root.length).replace(/^\/+/, '')

    return {
        fs: ensureLocalFs(root),
        path: relativePath,
    }
}

function joinLocalFsPath(fs: string, path: string) {
    const root = normalizeLocalRoot(fs)
    const relativePath = path.replace(/^\/+|\/+$/g, '')

    if (!relativePath) {
        return root
    }

    return root === '/' ? `/${relativePath}` : `${root}/${relativePath}`
}
