import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    CopyIcon,
    FilePenLineIcon,
    FolderPlusIcon,
    PlayIcon,
    SaveIcon,
    StarIcon,
    TerminalIcon,
    Trash2Icon,
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
import { formatTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import {
    createServerPreset,
    deleteServerPreset,
    fetchServerPresets,
    saveServerPreset,
} from '@/lib/server-data'
import {
    buildPresetCli,
    buildPresetDraft,
    createTransferPreset,
    formatManualFlags,
    getTransferExecutionMode,
    loadTransferPresets,
    type PresetTransferMode,
    parseRcloneCommandToDraft,
    TRANSFER_PRESETS_KEY,
    type TransferPreset,
    updateTransferPreset,
} from '@/lib/transfer-presets'
import type { TransferExecutionMode } from '@/lib/transfer-runtime'

const modeItems = [
    { label: 'copy', value: 'copy' },
    { label: 'move', value: 'move' },
    { label: 'sync', value: 'sync' },
]
const executionModeItems = [
    { label: 'RC native', value: 'rc' },
    { label: 'CLI', value: 'cli' },
]
const defaultPresetFlags = '--transfers 4\n--checkers 8\n--stats 1s\n--log-level INFO'

export function TransferPresetsPage() {
    const t = useT()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [mode, setMode] = useState<PresetTransferMode>('copy')
    const [executionMode, setExecutionMode] = useState<TransferExecutionMode>('rc')
    const [source, setSource] = useState('')
    const [target, setTarget] = useState('')
    const [manualFlags, setManualFlags] = useState(defaultPresetFlags)
    const [keepHistory, setKeepHistory] = useState(true)
    const [retryAfterFinish, setRetryAfterFinish] = useState(false)
    const [cliInput, setCliInput] = useState('')

    const presetsQuery = useQuery({
        queryKey: ['transfer-presets'],
        queryFn: fetchServerPresets,
    })
    const presets = presetsQuery.data ?? []

    const savePresetMutation = useMutation({
        mutationFn: (preset: TransferPreset) =>
            presets.some((item) => item.id === preset.id)
                ? saveServerPreset(preset)
                : createServerPreset(preset),
        onSuccess: (preset) => {
            setEditingId(preset.id)
            queryClient.invalidateQueries({ queryKey: ['transfer-presets'] })
            toast.success(t('transferPresets.saveSuccess'))
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : t('common.unknownError'))
        },
    })

    const deletePresetMutation = useMutation({
        mutationFn: deleteServerPreset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transfer-presets'] })
            toast.success(t('transferPresets.deleteSuccess'))
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : t('common.unknownError'))
        },
    })

    useEffect(() => {
        const localPresets = loadTransferPresets()
        if (localPresets.length === 0) {
            return
        }

        Promise.all(localPresets.map((preset) => saveServerPreset(preset)))
            .then(() => {
                localStorage.removeItem(TRANSFER_PRESETS_KEY)
                queryClient.invalidateQueries({ queryKey: ['transfer-presets'] })
            })
            .catch(() => {})
    }, [queryClient])

    const draftResult = useMemo(() => {
        try {
            return {
                draft: buildPresetDraft({
                    name,
                    description,
                    mode,
                    executionMode,
                    source,
                    target,
                    manualFlags,
                    keepHistory,
                    retryAfterFinish,
                }),
                error: '',
            }
        } catch (error) {
            return {
                draft: null,
                error: error instanceof Error ? error.message : t('common.unknownError'),
            }
        }
    }, [
        description,
        executionMode,
        keepHistory,
        manualFlags,
        mode,
        name,
        retryAfterFinish,
        source,
        target,
        t,
    ])

    function resetForm() {
        setEditingId(null)
        setName('')
        setDescription('')
        setMode('copy')
        setExecutionMode('rc')
        setSource('')
        setTarget('')
        setManualFlags(defaultPresetFlags)
        setKeepHistory(true)
        setRetryAfterFinish(false)
    }

    function handleSave() {
        if (!draftResult.draft) {
            toast.error(draftResult.error || t('common.unknownError'))
            return
        }

        const existing = editingId ? presets.find((preset) => preset.id === editingId) : undefined
        const saved = existing
            ? updateTransferPreset(existing, draftResult.draft)
            : createTransferPreset(draftResult.draft)

        savePresetMutation.mutate(saved)
    }

    function handleEdit(preset: TransferPreset) {
        setEditingId(preset.id)
        setName(preset.name)
        setDescription(preset.description)
        setMode(preset.mode)
        setExecutionMode(getTransferExecutionMode(preset))
        setSource(preset.source)
        setTarget(preset.target)
        setManualFlags(formatManualFlags(preset.args.slice(2)))
        setKeepHistory(preset.keepHistory)
        setRetryAfterFinish(preset.retryAfterFinish)
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    function handleDelete(preset: TransferPreset) {
        if (editingId === preset.id) {
            resetForm()
        }
        deletePresetMutation.mutate(preset.id)
    }

    function handleConvertCli() {
        try {
            const draft = parseRcloneCommandToDraft(cliInput)
            setEditingId(null)
            setName(draft.name)
            setDescription(draft.description)
            setMode(draft.mode)
            setExecutionMode(getTransferExecutionMode(draft))
            setSource(draft.source)
            setTarget(draft.target)
            setManualFlags(formatManualFlags(draft.args.slice(2)))
            setKeepHistory(draft.keepHistory)
            setRetryAfterFinish(draft.retryAfterFinish)
            toast.success(t('transferPresets.convertSuccess'))
        } catch (error) {
            toast.error(
                t('transferPresets.convertError', {
                    message: error instanceof Error ? error.message : t('common.unknownError'),
                })
            )
        }
    }

    async function handleCopyPreset(preset: TransferPreset) {
        try {
            await copyText(buildPresetCli(preset))
            toast.success(t('transferPresets.copySuccess'))
        } catch {
            toast.error(t('transferPresets.copyError'))
        }
    }

    return (
        <PageWrapper>
            <PageHeader
                title={t('transferPresets.title')}
                description={t('transferPresets.description')}
                actions={
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={resetForm}>
                            <FolderPlusIcon />
                            {t('transferPresets.newPreset')}
                        </Button>
                        <Button type="button" onClick={() => navigate('/transfers-adv')}>
                            <PlayIcon />
                            {t('transferPresets.openAdvanced')}
                        </Button>
                    </div>
                }
            />

            <PageContent>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.9fr)]">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transferPresets.formTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transferPresets.formDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    {editingId ? (
                                        <Badge variant="secondary">
                                            <FilePenLineIcon />
                                            {t('transferPresets.editing')}
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary">
                                            <StarIcon />
                                            {t('transferPresets.creating')}
                                        </Badge>
                                    )}
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <FieldGroup>
                                    <div className="grid gap-4 md:grid-cols-3">
                                        <Field>
                                            <FieldLabel>{t('transferPresets.name')}</FieldLabel>
                                            <Input
                                                value={name}
                                                onChange={(event) => setName(event.target.value)}
                                                placeholder="Nightly backup"
                                            />
                                        </Field>
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.modeTitle')}</FieldLabel>
                                            <Select
                                                items={modeItems}
                                                value={mode}
                                                onValueChange={(value) =>
                                                    setMode((value ?? 'copy') as PresetTransferMode)
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
                                                value={executionMode}
                                                onValueChange={(value) =>
                                                    setExecutionMode(
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
                                    </div>

                                    <Field>
                                        <FieldLabel>
                                            {t('transferPresets.descriptionLabel')}
                                        </FieldLabel>
                                        <Input
                                            value={description}
                                            onChange={(event) => setDescription(event.target.value)}
                                            placeholder="Optional note"
                                        />
                                    </Field>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.source')}</FieldLabel>
                                            <Input
                                                value={source}
                                                onChange={(event) => setSource(event.target.value)}
                                                placeholder="/data/source or remote:path"
                                            />
                                        </Field>
                                        <Field>
                                            <FieldLabel>{t('transfersAdv.target')}</FieldLabel>
                                            <Input
                                                value={target}
                                                onChange={(event) => setTarget(event.target.value)}
                                                placeholder="/data/target or remote:path"
                                            />
                                        </Field>
                                    </div>

                                    <Field>
                                        <FieldLabel>{t('transferPresets.options')}</FieldLabel>
                                        <Textarea
                                            className="min-h-36 font-mono"
                                            value={manualFlags}
                                            onChange={(event) => setManualFlags(event.target.value)}
                                            spellCheck={false}
                                        />
                                        <FieldDescription>
                                            {t('transfersAdv.manualFlagsDescription')}
                                        </FieldDescription>
                                    </Field>

                                    <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
                                        <label className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={keepHistory}
                                                onCheckedChange={(checked) =>
                                                    setKeepHistory(Boolean(checked))
                                                }
                                            />
                                            {t('transfersAdv.keepHistory')}
                                        </label>
                                        <label className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={retryAfterFinish}
                                                onCheckedChange={(checked) =>
                                                    setRetryAfterFinish(Boolean(checked))
                                                }
                                            />
                                            {t('transfersAdv.retryAfterFinish')}
                                        </label>
                                    </div>
                                </FieldGroup>

                                <div className="rounded-xl border bg-muted/40 p-3">
                                    <div className="mb-2 text-sm font-medium">
                                        {t('transfersAdv.commandPreview')}
                                    </div>
                                    <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted-foreground">
                                        {draftResult.draft?.preview || draftResult.error}
                                    </pre>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button type="button" variant="outline" onClick={resetForm}>
                                        {t('common.reset')}
                                    </Button>
                                    <Button
                                        type="button"
                                        disabled={!draftResult.draft}
                                        onClick={handleSave}
                                    >
                                        <SaveIcon />
                                        {editingId
                                            ? t('common.saveChanges')
                                            : t('transferPresets.savePreset')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <div>
                                    <CardTitle>{t('transferPresets.cliTitle')}</CardTitle>
                                    <CardDescription>
                                        {t('transferPresets.cliDescription')}
                                    </CardDescription>
                                </div>
                                <CardAction>
                                    <TerminalIcon className="size-4 text-muted-foreground" />
                                </CardAction>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea
                                    className="min-h-32 font-mono"
                                    value={cliInput}
                                    onChange={(event) => setCliInput(event.target.value)}
                                    placeholder='rclone copy "/data/photos" drive:photos --transfers 8 --fast-list'
                                    spellCheck={false}
                                />
                                <div className="flex justify-end">
                                    <Button type="button" onClick={handleConvertCli}>
                                        <TerminalIcon />
                                        {t('transferPresets.convertCli')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <div>
                                <CardTitle>{t('transferPresets.listTitle')}</CardTitle>
                                <CardDescription>
                                    {t('transferPresets.listDescription')}
                                </CardDescription>
                            </div>
                            <CardAction>
                                <Badge variant="secondary">{presets.length}</Badge>
                            </CardAction>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-hidden rounded-xl border">
                                <Table className="min-w-[720px]">
                                    <TableHeader className="bg-muted/40">
                                        <TableRow>
                                            <TableHead>{t('transferPresets.name')}</TableHead>
                                            <TableHead>{t('transfersAdv.route')}</TableHead>
                                            <TableHead>{t('transferPresets.updated')}</TableHead>
                                            <TableHead>{t('common.actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {presets.length === 0 ? (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={4}
                                                    className="py-8 text-center text-muted-foreground"
                                                >
                                                    {t('transferPresets.empty')}
                                                </TableCell>
                                            </TableRow>
                                        ) : null}
                                        {presets.map((preset) => (
                                            <TableRow key={preset.id}>
                                                <TableCell>
                                                    <div className="max-w-[220px] space-y-1">
                                                        <div className="truncate font-medium">
                                                            {preset.name}
                                                        </div>
                                                        {preset.description ? (
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {preset.description}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="max-w-[300px] space-y-1">
                                                        <div className="truncate text-sm">
                                                            {preset.source}
                                                        </div>
                                                        <div className="truncate text-xs text-muted-foreground">
                                                            {preset.mode} to {preset.target}
                                                        </div>
                                                        <Badge variant="outline">
                                                            {formatExecutionMode(
                                                                getTransferExecutionMode(preset)
                                                            )}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {formatTime(preset.updatedAt)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleEdit(preset)}
                                                        >
                                                            <FilePenLineIcon />
                                                            {t('transferPresets.edit')}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleCopyPreset(preset)}
                                                        >
                                                            <CopyIcon />
                                                            {t('transferPresets.copyCli')}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => handleDelete(preset)}
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
                </div>
            </PageContent>
        </PageWrapper>
    )
}

function formatExecutionMode(mode: TransferExecutionMode) {
    return mode === 'rc' ? 'RC native' : 'CLI'
}

async function copyText(value: string) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value)
            return
        } catch {}
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.append(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)

    try {
        if (!document.execCommand('copy')) {
            throw new Error('Fallback copy failed.')
        }
    } finally {
        textarea.remove()
    }
}
