import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    CalendarClockIcon,
    CheckCircle2Icon,
    ClockIcon,
    FileWarningIcon,
    ListRestartIcon,
    PlayIcon,
    SaveIcon,
    TerminalIcon,
    Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
    createSchedule,
    deleteSchedule,
    fetchScheduleRuns,
    fetchSchedules,
    fetchServerPresets,
    type IntervalUnit,
    runScheduleNow,
    type ScheduledCommand,
    type ScheduleKind,
    type ScheduleRun,
    saveSchedule,
    type TransferSchedule,
} from '@/lib/server-data'
import { useStore } from '@/lib/store'
import {
    buildPresetCli,
    buildPresetDraft,
    formatManualFlags,
    getTransferExecutionMode,
    type PresetTransferMode,
    parseRcloneCommandToDraft,
} from '@/lib/transfer-presets'
import type { TransferExecutionMode } from '@/lib/transfer-runtime'
import { cn } from '@/lib/ui'

type CommandSource = 'cli' | 'preset' | 'builder'

const modeItems = [
    { label: 'copy', value: 'copy' },
    { label: 'move', value: 'move' },
    { label: 'sync', value: 'sync' },
]

const intervalUnitItems = [
    { label: 'Minutes', value: 'minutes' },
    { label: 'Hours', value: 'hours' },
    { label: 'Days', value: 'days' },
    { label: 'Weeks', value: 'weeks' },
]

const executionModeItems = [
    { label: 'RC native', value: 'rc' },
    { label: 'CLI', value: 'cli' },
]

export function SchedulerPage() {
    const t = useT()
    const queryClient = useQueryClient()
    const rcUrl = useStore((state) => state.url)
    const rcUser = useStore((state) => state.user)
    const rcPass = useStore((state) => state.pass)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [commandSource, setCommandSource] = useState<CommandSource>('cli')
    const [cliInput, setCliInput] = useState(
        'rclone copy /data/source remote:backup --transfers 4 --checkers 8 --stats 1s --log-level INFO'
    )
    const [presetId, setPresetId] = useState('')
    const [builderMode, setBuilderMode] = useState<PresetTransferMode>('copy')
    const [builderExecutionMode, setBuilderExecutionMode] = useState<TransferExecutionMode>('rc')
    const [builderSource, setBuilderSource] = useState('')
    const [builderTarget, setBuilderTarget] = useState('')
    const [builderOptions, setBuilderOptions] = useState(
        '--transfers 4\n--checkers 8\n--stats 1s\n--log-level INFO'
    )
    const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval')
    const [intervalValue, setIntervalValue] = useState('30')
    const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minutes')
    const [cronExpression, setCronExpression] = useState('*/30 * * * *')
    const [enabled, setEnabled] = useState(true)
    const [showLogs, setShowLogs] = useState(true)
    const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

    const presetsQuery = useQuery({
        queryKey: ['transfer-presets'],
        queryFn: fetchServerPresets,
    })
    const schedulesQuery = useQuery({
        queryKey: ['transfer-schedules'],
        queryFn: fetchSchedules,
        refetchInterval: 5000,
    })
    const runsQuery = useQuery({
        queryKey: ['schedule-runs'],
        queryFn: () => fetchScheduleRuns(100),
        refetchInterval: 2500,
    })

    const presets = presetsQuery.data ?? []
    const schedules = schedulesQuery.data ?? []
    const runs = runsQuery.data ?? []

    const commandResult = useMemo(() => {
        try {
            return { command: buildScheduledCommand(), error: '' }
        } catch (error) {
            return {
                command: null,
                error: error instanceof Error ? error.message : t('common.unknownError'),
            }
        }
    }, [
        builderMode,
        builderExecutionMode,
        builderOptions,
        builderSource,
        builderTarget,
        cliInput,
        commandSource,
        presetId,
        presets,
        t,
    ])

    const saveMutation = useMutation({
        mutationFn: (schedule: TransferSchedule) =>
            schedules.some((item) => item.id === schedule.id)
                ? saveSchedule(schedule)
                : createSchedule(schedule),
        onSuccess: () => {
            resetForm()
            queryClient.invalidateQueries({ queryKey: ['transfer-schedules'] })
            toast.success(t('scheduler.saveSuccess'))
        },
        onError: (error) => {
            toast.error(
                t('scheduler.saveError', {
                    message: error instanceof Error ? error.message : t('common.unknownError'),
                })
            )
        },
    })

    const deleteMutation = useMutation({
        mutationFn: deleteSchedule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transfer-schedules'] })
            toast.success(t('scheduler.deleteSuccess'))
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : t('common.unknownError'))
        },
    })

    const runMutation = useMutation({
        mutationFn: runScheduleNow,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedule-runs'] })
            queryClient.invalidateQueries({ queryKey: ['transfer-schedules'] })
            toast.success(t('scheduler.runNowSuccess'))
        },
        onError: (error) => {
            toast.error(
                t('scheduler.runNowError', {
                    message: error instanceof Error ? error.message : t('common.unknownError'),
                })
            )
        },
    })

    function buildScheduledCommand(): ScheduledCommand {
        if (commandSource === 'cli') {
            const draft = parseRcloneCommandToDraft(cliInput)
            return {
                mode: draft.mode,
                executionMode: getTransferExecutionMode(draft),
                source: draft.source,
                target: draft.target,
                args: draft.args,
                preview: draft.preview,
                origin: 'cli',
            }
        }

        if (commandSource === 'preset') {
            const preset = presets.find((item) => item.id === presetId)
            if (!preset) {
                throw new Error('Preset is required.')
            }

            return {
                mode: preset.mode,
                executionMode: getTransferExecutionMode(preset),
                source: preset.source,
                target: preset.target,
                args: preset.args,
                preview: buildPresetCli(preset),
                origin: 'preset',
                presetId: preset.id,
                presetName: preset.name,
            }
        }

        const draft = buildPresetDraft({
            name: name || 'Scheduled transfer',
            description,
            mode: builderMode,
            executionMode: builderExecutionMode,
            source: builderSource,
            target: builderTarget,
            manualFlags: builderOptions,
            keepHistory: true,
            retryAfterFinish: false,
        })

        return {
            mode: draft.mode,
            executionMode: getTransferExecutionMode(draft),
            source: draft.source,
            target: draft.target,
            args: draft.args,
            preview: draft.preview,
            origin: 'builder',
        }
    }

    function buildSchedule() {
        if (!commandResult.command) {
            throw new Error(commandResult.error || t('common.unknownError'))
        }

        if (!rcUrl) {
            throw new Error('Rclone RC connection is required.')
        }

        const now = new Date().toISOString()

        return {
            id: editingId || createId(),
            name: name.trim() || inferScheduleName(commandResult.command),
            description: description.trim(),
            command: commandResult.command,
            scheduleKind,
            intervalValue: Math.max(1, Number.parseInt(intervalValue, 10) || 1),
            intervalUnit,
            cronExpression: cronExpression.trim() || '*/30 * * * *',
            enabled,
            showLogs,
            rc: { url: rcUrl, user: rcUser, pass: rcPass },
            nextRunAt: '',
            lastRunAt: schedules.find((item) => item.id === editingId)?.lastRunAt ?? '',
            createdAt: schedules.find((item) => item.id === editingId)?.createdAt ?? now,
            updatedAt: now,
        } satisfies TransferSchedule
    }

    function handleSave() {
        try {
            saveMutation.mutate(buildSchedule())
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('common.unknownError'))
        }
    }

    function handleEdit(schedule: TransferSchedule) {
        setEditingId(schedule.id)
        setName(schedule.name)
        setDescription(schedule.description)
        setScheduleKind(schedule.scheduleKind)
        setIntervalValue(String(schedule.intervalValue))
        setIntervalUnit(schedule.intervalUnit)
        setCronExpression(schedule.cronExpression)
        setEnabled(schedule.enabled)
        setShowLogs(schedule.showLogs)

        if (schedule.command.origin === 'preset' && schedule.command.presetId) {
            setCommandSource('preset')
            setPresetId(schedule.command.presetId)
        } else if (schedule.command.origin === 'cli') {
            setCommandSource('cli')
            setCliInput(schedule.command.preview)
        } else {
            setCommandSource('builder')
            setBuilderMode(schedule.command.mode)
            setBuilderExecutionMode(schedule.command.executionMode ?? 'cli')
            setBuilderSource(schedule.command.source)
            setBuilderTarget(schedule.command.target)
            setBuilderOptions(formatManualFlags(schedule.command.args.slice(2)))
        }

        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    function handleToggle(schedule: TransferSchedule) {
        saveMutation.mutate({ ...schedule, enabled: !schedule.enabled })
    }

    function resetForm() {
        setEditingId(null)
        setName('')
        setDescription('')
        setCommandSource('cli')
        setBuilderExecutionMode('rc')
        setScheduleKind('interval')
        setIntervalValue('30')
        setIntervalUnit('minutes')
        setCronExpression('*/30 * * * *')
        setEnabled(true)
        setShowLogs(true)
    }

    return (
        <PageWrapper>
            <PageHeader
                title={t('scheduler.title')}
                description={t('scheduler.description')}
                actions={
                    <Button type="button" size="lg" onClick={handleSave}>
                        <SaveIcon />
                        {editingId ? t('common.saveChanges') : t('scheduler.saveSchedule')}
                    </Button>
                }
            />

            <PageContent>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(440px,0.9fr)]">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('scheduler.commandTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('scheduler.commandDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <div className="inline-flex rounded-lg border bg-background p-0.5">
                                        <SourceButton
                                            active={commandSource === 'cli'}
                                            onClick={() => setCommandSource('cli')}
                                        >
                                            <TerminalIcon className="size-3.5" />
                                            CLI
                                        </SourceButton>
                                        <SourceButton
                                            active={commandSource === 'preset'}
                                            onClick={() => setCommandSource('preset')}
                                        >
                                            <ListRestartIcon className="size-3.5" />
                                            Preset
                                        </SourceButton>
                                        <SourceButton
                                            active={commandSource === 'builder'}
                                            onClick={() => setCommandSource('builder')}
                                        >
                                            <CalendarClockIcon className="size-3.5" />
                                            Builder
                                        </SourceButton>
                                    </div>
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <FieldGroup>
                                    <Field>
                                        <FieldLabel>{t('scheduler.name')}</FieldLabel>
                                        <Input
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            placeholder="Daily backup"
                                        />
                                    </Field>

                                    <Field>
                                        <FieldLabel>{t('scheduler.descriptionLabel')}</FieldLabel>
                                        <Input
                                            value={description}
                                            onChange={(event) => setDescription(event.target.value)}
                                            placeholder="Optional note"
                                        />
                                    </Field>
                                </FieldGroup>

                                {commandSource === 'cli' ? (
                                    <Field>
                                        <FieldLabel>{t('scheduler.cliCommand')}</FieldLabel>
                                        <Textarea
                                            className="min-h-32 font-mono"
                                            value={cliInput}
                                            onChange={(event) => setCliInput(event.target.value)}
                                            spellCheck={false}
                                        />
                                    </Field>
                                ) : null}

                                {commandSource === 'preset' ? (
                                    <Field>
                                        <FieldLabel>{t('scheduler.preset')}</FieldLabel>
                                        <Select
                                            items={presets.map((preset) => ({
                                                label: preset.name,
                                                value: preset.id,
                                            }))}
                                            value={presetId}
                                            onValueChange={(value) => setPresetId(value ?? '')}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {presets.map((preset) => (
                                                        <SelectItem
                                                            key={preset.id}
                                                            value={preset.id}
                                                        >
                                                            <span>{preset.name}</span>
                                                            <span className="text-muted-foreground">
                                                                {preset.mode}
                                                            </span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                ) : null}

                                {commandSource === 'builder' ? (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.modeTitle')}</FieldLabel>
                                            <Select
                                                items={modeItems}
                                                value={builderMode}
                                                onValueChange={(value) =>
                                                    setBuilderMode(
                                                        (value ?? 'copy') as PresetTransferMode
                                                    )
                                                }
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {modeItems.map((item) => (
                                                            <SelectItem
                                                                key={item.value}
                                                                value={item.value}
                                                            >
                                                                {item.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        <Field>
                                            <FieldLabel>
                                                {t('transferPresets.executionMode')}
                                            </FieldLabel>
                                            <Select
                                                items={executionModeItems}
                                                value={builderExecutionMode}
                                                onValueChange={(value) =>
                                                    setBuilderExecutionMode(
                                                        (value ?? 'rc') as TransferExecutionMode
                                                    )
                                                }
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        <SelectItem value="rc">
                                                            {t('transferPresets.executionModeRc')}
                                                        </SelectItem>
                                                        <SelectItem value="cli">
                                                            {t('transferPresets.executionModeCli')}
                                                        </SelectItem>
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        <Field>
                                            <FieldLabel>{t('transferPresets.options')}</FieldLabel>
                                            <Input
                                                value={builderOptions.replace(/\n/g, ' ')}
                                                onChange={(event) =>
                                                    setBuilderOptions(event.target.value)
                                                }
                                            />
                                        </Field>
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.source')}</FieldLabel>
                                            <Input
                                                value={builderSource}
                                                onChange={(event) =>
                                                    setBuilderSource(event.target.value)
                                                }
                                                placeholder="/data/source or remote:path"
                                            />
                                        </Field>
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.target')}</FieldLabel>
                                            <Input
                                                value={builderTarget}
                                                onChange={(event) =>
                                                    setBuilderTarget(event.target.value)
                                                }
                                                placeholder="/data/target or remote:path"
                                            />
                                        </Field>
                                    </div>
                                ) : null}

                                <div className="rounded-xl border bg-muted/40 p-3">
                                    <div className="mb-2 text-sm font-medium">
                                        {t('transfersAdv.commandPreview')}
                                    </div>
                                    <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted-foreground">
                                        {commandResult.command?.preview || commandResult.error}
                                    </pre>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('scheduler.scheduleTitle')}</CardTitle>
                                <CardDescription>
                                    {t('scheduler.scheduleDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="grid gap-4 md:grid-cols-3">
                                    <Field>
                                        <FieldLabel>{t('scheduler.scheduleType')}</FieldLabel>
                                        <Select
                                            items={[
                                                { label: 'Interval', value: 'interval' },
                                                { label: 'Cron', value: 'cron' },
                                            ]}
                                            value={scheduleKind}
                                            onValueChange={(value) =>
                                                setScheduleKind(
                                                    value === 'cron' ? 'cron' : 'interval'
                                                )
                                            }
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value="interval">
                                                        Interval
                                                    </SelectItem>
                                                    <SelectItem value="cron">Cron</SelectItem>
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>

                                    {scheduleKind === 'interval' ? (
                                        <>
                                            <Field>
                                                <FieldLabel>
                                                    {t('scheduler.intervalEvery')}
                                                </FieldLabel>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={intervalValue}
                                                    onChange={(event) =>
                                                        setIntervalValue(event.target.value)
                                                    }
                                                />
                                            </Field>
                                            <Field>
                                                <FieldLabel>
                                                    {t('scheduler.intervalUnit')}
                                                </FieldLabel>
                                                <Select
                                                    items={intervalUnitItems}
                                                    value={intervalUnit}
                                                    onValueChange={(value) =>
                                                        setIntervalUnit(
                                                            (value ?? 'minutes') as IntervalUnit
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectGroup>
                                                            {intervalUnitItems.map((item) => (
                                                                <SelectItem
                                                                    key={item.value}
                                                                    value={item.value}
                                                                >
                                                                    {item.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectGroup>
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                        </>
                                    ) : (
                                        <Field className="md:col-span-2">
                                            <FieldLabel>{t('scheduler.cronExpression')}</FieldLabel>
                                            <Input
                                                className="font-mono"
                                                value={cronExpression}
                                                onChange={(event) =>
                                                    setCronExpression(event.target.value)
                                                }
                                            />
                                            <FieldDescription>
                                                {t('scheduler.cronDescription')}
                                            </FieldDescription>
                                        </Field>
                                    )}
                                </div>

                                <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={enabled}
                                            onCheckedChange={(checked) =>
                                                setEnabled(Boolean(checked))
                                            }
                                        />
                                        {t('scheduler.enabled')}
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={showLogs}
                                            onCheckedChange={(checked) =>
                                                setShowLogs(Boolean(checked))
                                            }
                                        />
                                        {t('scheduler.collectLogs')}
                                    </label>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button type="button" variant="outline" onClick={resetForm}>
                                        {t('common.reset')}
                                    </Button>
                                    <Button
                                        type="button"
                                        disabled={saveMutation.isPending}
                                        onClick={handleSave}
                                    >
                                        <SaveIcon />
                                        {editingId
                                            ? t('common.saveChanges')
                                            : t('scheduler.saveSchedule')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('scheduler.savedTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('scheduler.savedDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <Badge variant="secondary">{schedules.length}</Badge>
                                </CardAction>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-hidden rounded-xl border">
                                    <Table className="min-w-[760px]">
                                        <TableHeader className="bg-muted/40">
                                            <TableRow>
                                                <TableHead>{t('scheduler.name')}</TableHead>
                                                <TableHead>{t('scheduler.nextRun')}</TableHead>
                                                <TableHead>{t('scheduler.status')}</TableHead>
                                                <TableHead>{t('common.actions')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {schedules.length === 0 ? (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={4}
                                                        className="py-8 text-center text-muted-foreground"
                                                    >
                                                        {t('scheduler.emptySchedules')}
                                                    </TableCell>
                                                </TableRow>
                                            ) : null}
                                            {schedules.map((schedule) => (
                                                <TableRow key={schedule.id}>
                                                    <TableCell>
                                                        <div className="max-w-[260px] space-y-1">
                                                            <div className="truncate font-medium">
                                                                {schedule.name}
                                                            </div>
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {schedule.command.preview}
                                                            </div>
                                                            <Badge variant="outline">
                                                                {formatExecutionMode(
                                                                    schedule.command
                                                                        .executionMode ?? 'cli'
                                                                )}
                                                            </Badge>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {schedule.nextRunAt
                                                            ? formatTime(schedule.nextRunAt)
                                                            : '-'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge
                                                            variant="secondary"
                                                            className={cn(
                                                                schedule.enabled
                                                                    ? 'bg-emerald-500/15 text-emerald-600'
                                                                    : 'bg-muted text-muted-foreground'
                                                            )}
                                                        >
                                                            {schedule.enabled
                                                                ? t('scheduler.enabled')
                                                                : t('scheduler.disabled')}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap gap-2">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    runMutation.mutate(schedule.id)
                                                                }
                                                            >
                                                                <PlayIcon />
                                                                {t('scheduler.runNow')}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleEdit(schedule)}
                                                            >
                                                                {t('transferPresets.edit')}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() =>
                                                                    handleToggle(schedule)
                                                                }
                                                            >
                                                                {schedule.enabled
                                                                    ? t('scheduler.disable')
                                                                    : t('scheduler.enable')}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="destructive"
                                                                onClick={() =>
                                                                    deleteMutation.mutate(
                                                                        schedule.id
                                                                    )
                                                                }
                                                            >
                                                                <Trash2Icon />
                                                                {t('common.delete')}
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('scheduler.runsTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('scheduler.runsDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <ClockIcon className="size-4 text-muted-foreground" />
                                </CardAction>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {runs.length === 0 ? (
                                        <div className="rounded-lg border px-3 py-8 text-center text-sm text-muted-foreground">
                                            {t('scheduler.emptyRuns')}
                                        </div>
                                    ) : null}
                                    {runs.map((run) => (
                                        <RunCard
                                            key={run.id}
                                            run={run}
                                            expanded={expandedRunId === run.id}
                                            onToggle={() =>
                                                setExpandedRunId((current) =>
                                                    current === run.id ? null : run.id
                                                )
                                            }
                                        />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </PageContent>
        </PageWrapper>
    )
}

function SourceButton({
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

function RunCard({
    run,
    expanded,
    onToggle,
}: {
    run: ScheduleRun
    expanded: boolean
    onToggle: () => void
}) {
    const t = useT()
    const duration = run.durationMs > 0 ? formatDuration(Math.round(run.durationMs / 1000)) : '-'

    return (
        <div className="rounded-xl border">
            <div className="grid gap-3 px-3 py-3 md:grid-cols-[1fr_auto] md:items-start">
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <RunStatusBadge status={run.status} />
                        <span className="truncate text-sm font-medium">{run.scheduleName}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                        {run.commandPreview}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatTime(run.startedAt)}</div>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={onToggle}>
                    {expanded ? t('scheduler.hideLogs') : t('scheduler.showLogs')}
                </Button>
            </div>

            <div className="grid gap-2 border-t bg-muted/20 px-3 py-3 sm:grid-cols-4">
                <RunMetric label={t('scheduler.successCount')} value={String(run.successCount)} />
                <RunMetric label={t('scheduler.failedCount')} value={String(run.failedCount)} />
                <RunMetric label={t('scheduler.transferBytes')} value={formatBytes(run.bytes)} />
                <RunMetric label={t('scheduler.duration')} value={duration} />
            </div>

            {expanded ? (
                <div className="border-t p-3">
                    {run.errorText ? (
                        <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {run.errorText}
                        </div>
                    ) : null}
                    <div className="max-h-56 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
                        {run.logs.length > 0
                            ? run.logs.map((line) => <div key={line}>{line}</div>)
                            : t('scheduler.noLogs')}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

function RunStatusBadge({ status }: { status: ScheduleRun['status'] }) {
    const t = useT()
    const Icon =
        status === 'completed'
            ? CheckCircle2Icon
            : status === 'failed'
              ? FileWarningIcon
              : ClockIcon

    return (
        <Badge
            variant="secondary"
            className={cn(
                status === 'completed' && 'bg-emerald-500/15 text-emerald-600',
                status === 'failed' && 'bg-destructive/15 text-destructive',
                status === 'running' && 'bg-sky-500/15 text-sky-600'
            )}
        >
            <Icon className={cn(status === 'running' && 'animate-spin')} />
            {status === 'completed'
                ? t('transfersAdv.completed')
                : status === 'failed'
                  ? t('transfersAdv.failed')
                  : t('transfersAdv.running')}
        </Badge>
    )
}

function RunMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 font-medium tabular-nums">{value}</div>
        </div>
    )
}

function inferScheduleName(command: ScheduledCommand) {
    if (command.presetName) {
        return command.presetName
    }

    return `${command.mode} ${command.source} to ${command.target}`
}

function formatExecutionMode(mode: TransferExecutionMode) {
    return mode === 'rc' ? 'RC native' : 'CLI'
}

function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
