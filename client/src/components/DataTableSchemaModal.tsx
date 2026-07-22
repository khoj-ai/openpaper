"use client";

import { useState } from "react";
import { X, Plus, Table, Loader2, Sparkles, Info, List, ListPlus, Calculator } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogHeader,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogClose
} from "@/components/ui/dialog";
import Link from "next/link";
import { fetchFromApi } from "@/lib/api";
import { ProposedDataTableColumn } from "@/lib/schema";

export interface FieldDefinition {
    id: string;
    label: string;
    kind: 'primitive' | 'list' | 'derived';
    // For derived fields: the calculator expression over aliases, and the
    // mapping of each alias to a primitive/list field label.
    expression?: string;
    inputs?: { [alias: string]: string };
    // Where the papers ground this field, per the propose agent's investigation.
    evidence?: string;
}

interface DataTableSchemaModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (fields: FieldDefinition[]) => void;
    projectId: string;
    isCreating?: boolean;
    atLimit?: boolean;
}

// The modal starts as a single prompt box. Fields only appear once the AI
// proposal comes back ('augmented') or the user opts into manual entry
// ('manual'), which hides the prompt box entirely.
type SchemaMode = 'prompt' | 'augmented' | 'manual';

export default function DataTableSchemaModal({
    open,
    onOpenChange,
    onSubmit,
    projectId,
    isCreating = false,
    atLimit = false
}: DataTableSchemaModalProps) {
    const [mode, setMode] = useState<SchemaMode>('prompt');
    const [prompt, setPrompt] = useState('');
    const [isProposing, setIsProposing] = useState(false);
    const [fields, setFields] = useState<FieldDefinition[]>([
        { id: '1', label: '', kind: 'primitive' }
    ]);

    const resetState = () => {
        setMode('prompt');
        setPrompt('');
        setFields([{ id: '1', label: '', kind: 'primitive' }]);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            resetState();
        }
        onOpenChange(nextOpen);
    };

    const handleProposeSchema = async () => {
        if (!prompt.trim()) {
            return;
        }

        setIsProposing(true);
        try {
            const response: { columns: ProposedDataTableColumn[] } = await fetchFromApi(`/api/projects/tables/propose`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    project_id: projectId,
                    prompt: prompt.trim(),
                }),
            });

            if (!response.columns || response.columns.length === 0) {
                throw new Error("No columns returned");
            }

            setFields(response.columns.map((column, index) => ({
                id: (index + 1).toString(),
                label: column.label,
                kind: column.kind,
                expression: column.expression || undefined,
                inputs: column.kind === 'derived' ? column.inputs : undefined,
                evidence: column.evidence || undefined,
            })));
            setMode('augmented');
        } catch (err) {
            console.error("Failed to propose data table schema:", err);
            toast.error("Failed to suggest fields. Please try again or add fields manually.");
        } finally {
            setIsProposing(false);
        }
    };

    const addField = () => {
        const newId = (Math.max(...fields.map(f => parseInt(f.id)), 0) + 1).toString();
        setFields([...fields, { id: newId, label: '', kind: 'primitive' }]);
    };

    const removeField = (id: string) => {
        const removed = fields.find(field => field.id === id);
        const remaining = fields
            .filter(field => field.id !== id)
            // Removing a primitive invalidates any computed field that
            // reads from it — drop those too rather than run them broken.
            .filter(field =>
                !(removed && field.kind === 'derived' && field.inputs &&
                    Object.values(field.inputs).includes(removed.label))
            );
        // The cascade can empty the list; always leave something to edit.
        setFields(remaining.length > 0 ? remaining : [{ id: '1', label: '', kind: 'primitive' }]);
    };

    const updateField = (id: string, value: string) => {
        const previous = fields.find(field => field.id === id);
        setFields(fields.map(field => {
            if (field.id === id) {
                return { ...field, label: value };
            }
            // Keep computed-field input mappings pointing at the renamed field.
            if (
                previous && field.kind === 'derived' && field.inputs &&
                Object.values(field.inputs).includes(previous.label)
            ) {
                const inputs = Object.fromEntries(
                    Object.entries(field.inputs).map(([alias, column]) =>
                        [alias, column === previous.label ? value : column]
                    )
                );
                return { ...field, inputs };
            }
            return field;
        }));
    };

    const handleSubmit = () => {
        const labeled = fields.filter(field => field.label.trim() !== '');
        // A computed field is only submittable if every input still resolves
        // to a primitive field in the final set (labels can have been cleared
        // or edited out from under it).
        const primitiveLabels = new Set(
            labeled.filter(f => f.kind !== 'derived').map(f => f.label)
        );
        const validFields = labeled.filter(field =>
            field.kind !== 'derived' ||
            (field.expression && field.inputs &&
                Object.values(field.inputs).every(column => primitiveLabels.has(column)))
        );
        if (validFields.length === 0) {
            return;
        }
        onSubmit(validFields);
        resetState();
    };

    const canSubmit = fields.some(field => field.label.trim() !== '');
    const showFields = mode !== 'prompt';

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Data Table</DialogTitle>
                    <DialogDescription>
                        {mode === 'manual'
                            ? 'Define the fields for your data table. We will extract the corresponding information from each paper in your project.'
                            : 'Describe what you want to compare or extract across your papers, and we’ll suggest the fields for your table.'}
                    </DialogDescription>
                </DialogHeader>

                {atLimit ? (
                    <div className="mt-4 text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/30 rounded-md">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">You&apos;ve used all your data tables for this week.</p>
                        <Link href="/pricing" passHref>
                            <Button variant="link" className="p-0 h-auto text-sm">Upgrade your plan to create more.</Button>
                        </Link>
                    </div>
                ) : (
                    <>
                        <div className="mt-4 space-y-4">
                            {mode !== 'manual' && (
                                <div className="space-y-2">
                                    <Textarea
                                        id="schema-prompt"
                                        placeholder="e.g., Compare the methods, sample sizes, and key findings across these papers..."
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        rows={3}
                                        disabled={isProposing}
                                        autoFocus
                                    />
                                    <Button
                                        type="button"
                                        variant={mode === 'prompt' ? 'default' : 'outline'}
                                        onClick={handleProposeSchema}
                                        disabled={!prompt.trim() || isProposing}
                                        className="w-full"
                                    >
                                        {isProposing ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <Sparkles className="mr-2 h-4 w-4" />
                                        )}
                                        {isProposing
                                            ? 'Suggesting fields...'
                                            : mode === 'augmented' ? 'Suggest Again' : 'Suggest Fields'}
                                    </Button>
                                </div>
                            )}

                            {mode === 'prompt' && (
                                <>
                                    <div className="relative py-1">
                                        <div className="absolute inset-0 flex items-center">
                                            <span className="w-full border-t" />
                                        </div>
                                        <div className="relative flex justify-center">
                                            <span className="bg-background px-2 text-xs uppercase text-muted-foreground">or</span>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="link"
                                        onClick={() => {
                                            setFields([{ id: '1', label: '', kind: 'primitive' }]);
                                            setMode('manual');
                                        }}
                                        disabled={isProposing}
                                        className="w-full text-muted-foreground hover:text-foreground"
                                    >
                                        <ListPlus className="mr-2 h-4 w-4" />
                                        Enter fields manually instead
                                    </Button>
                                </>
                            )}

                            {showFields && (
                                <>
                                    <div className={`space-y-3 ${isProposing ? 'opacity-60' : ''}`}>
                                        {fields.map((field, index) => (
                                            <div key={field.id} className="space-y-1">
                                                <div className="flex gap-2 items-end">
                                                    <div className="flex-1">
                                                        <Label htmlFor={`label-${field.id}`} className="text-sm font-medium flex items-center gap-2">
                                                            Field {index + 1}
                                                            {field.kind === 'derived' && (
                                                                <Badge className="gap-1 px-1.5 py-0.5 text-[10px] shrink-0 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30">
                                                                    <Calculator className="h-3 w-3" />
                                                                    computed
                                                                </Badge>
                                                            )}
                                                            {field.kind === 'list' && (
                                                                <Badge className="gap-1 px-1.5 py-0.5 text-[10px] shrink-0 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                                                    <List className="h-3 w-3" />
                                                                    list
                                                                </Badge>
                                                            )}
                                                            {field.evidence && (
                                                                <HoverCard openDelay={100} closeDelay={100}>
                                                                    <HoverCardTrigger asChild>
                                                                        <span className="shrink-0 text-muted-foreground hover:text-foreground cursor-default">
                                                                            <Info className="h-3.5 w-3.5" />
                                                                        </span>
                                                                    </HoverCardTrigger>
                                                                    <HoverCardContent className="w-96 p-3 shadow-md bg-accent">
                                                                        <p className="text-xs font-semibold text-accent-foreground uppercase tracking-wide mb-1.5">
                                                                            Why this field
                                                                        </p>
                                                                        <p className="text-xs text-accent-foreground">{field.evidence}</p>
                                                                    </HoverCardContent>
                                                                </HoverCard>
                                                            )}
                                                        </Label>
                                                        <Input
                                                            id={`label-${field.id}`}
                                                            placeholder="e.g., Author, Year, Sample Size, Key Finding..."
                                                            value={field.label}
                                                            onChange={(e) => updateField(field.id, e.target.value)}
                                                            disabled={isProposing}
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                    {fields.length > 1 && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => removeField(field.id)}
                                                            disabled={isProposing}
                                                            className="shrink-0"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                                {field.kind === 'derived' && field.expression && (
                                                    <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded px-2 py-1">
                                                        = {field.expression}
                                                        {field.inputs && Object.entries(field.inputs).map(([alias, column]) => (
                                                            <div key={alias} className="pl-3 text-[11px]">
                                                                {alias} ← {column}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={addField}
                                        disabled={isProposing}
                                        className="w-full"
                                    >
                                        <Plus className="mr-2 h-4 w-4" />
                                        Add Field
                                    </Button>

                                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-md p-3">
                                        <p className="text-xs text-blue-800 dark:text-blue-200">
                                            <strong>Tip:</strong> Be specific with field labels for better results. For example, use &quot;Sample Size (n)&quot; instead of just &quot;Size&quot;.
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <DialogClose asChild>
                                <Button variant="secondary" disabled={isCreating}>
                                    Cancel
                                </Button>
                            </DialogClose>
                            {showFields && (
                                <Button
                                    onClick={handleSubmit}
                                    disabled={!canSubmit || isCreating || isProposing}
                                >
                                    {isCreating ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Table className="mr-2 h-4 w-4" />
                                    )}
                                    {isCreating ? 'Creating...' : 'Generate Table'}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
