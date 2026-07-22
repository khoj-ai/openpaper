"use client";

import { useState } from "react";
import { X, Plus, Table, Loader2, Sparkles, List, ListPlus, Calculator } from "lucide-react";
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
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setFields([{ id: '1', label: '', kind: 'primitive' }]);
                                        setMode('manual');
                                    }}
                                    disabled={isProposing}
                                    className="w-full text-muted-foreground"
                                >
                                    <ListPlus className="mr-2 h-4 w-4" />
                                    Enter fields manually instead
                                </Button>
                            )}

                            {showFields && (
                                <>
                                    <div className="space-y-3">
                                        {fields.map((field, index) => (
                                            <div key={field.id} className="space-y-1">
                                                <div className="flex gap-2 items-end">
                                                    <div className="flex-1">
                                                        <Label htmlFor={`label-${field.id}`} className="text-sm font-medium flex items-center gap-2">
                                                            Field {index + 1}
                                                            {field.kind === 'derived' && (
                                                                <Badge className="gap-1 px-1.5 py-0.5 text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30">
                                                                    <Calculator className="h-3 w-3" />
                                                                    computed
                                                                </Badge>
                                                            )}
                                                            {field.kind === 'list' && (
                                                                <Badge className="gap-1 px-1.5 py-0.5 text-[10px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                                                    <List className="h-3 w-3" />
                                                                    list
                                                                </Badge>
                                                            )}
                                                        </Label>
                                                        <Input
                                                            id={`label-${field.id}`}
                                                            placeholder="e.g., Author, Year, Sample Size, Key Finding..."
                                                            value={field.label}
                                                            onChange={(e) => updateField(field.id, e.target.value)}
                                                            className="mt-1"
                                                        />
                                                    </div>
                                                    {fields.length > 1 && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => removeField(field.id)}
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
                                    disabled={!canSubmit || isCreating}
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
