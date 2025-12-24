"use client";

import { useState } from "react";
import { X, Plus, Table, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogHeader,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogClose
} from "@/components/ui/dialog";
import Link from "next/link";

export interface FieldDefinition {
    id: string;
    label: string;
}

interface DataTableSchemaModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (fields: FieldDefinition[]) => void;
    isCreating?: boolean;
    atLimit?: boolean;
}

export default function DataTableSchemaModal({
    open,
    onOpenChange,
    onSubmit,
    isCreating = false,
    atLimit = false
}: DataTableSchemaModalProps) {
    const [fields, setFields] = useState<FieldDefinition[]>([
        { id: '1', label: '' }
    ]);

    const addField = () => {
        const newId = (Math.max(...fields.map(f => parseInt(f.id)), 0) + 1).toString();
        setFields([...fields, { id: newId, label: '' }]);
    };

    const removeField = (id: string) => {
        if (fields.length > 1) {
            setFields(fields.filter(field => field.id !== id));
        }
    };

    const updateField = (id: string, value: string) => {
        setFields(fields.map(field =>
            field.id === id ? { ...field, label: value } : field
        ));
    };

    const handleSubmit = () => {
        const validFields = fields.filter(field => field.label.trim() !== '');
        if (validFields.length === 0) {
            return;
        }
        onSubmit(validFields);
        // Reset state
        setFields([{ id: '1', label: '' }]);
    };

    const canSubmit = fields.some(field => field.label.trim() !== '');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Define Data Table Schema</DialogTitle>
                    <DialogDescription>
                        Define the fields for a custom data table. The AI will then extract the corresponding information from each paper in your project.
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
                            <div className="space-y-3">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <Label htmlFor={`label-${field.id}`} className="text-sm font-medium">
                                                Field {index + 1}
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
                                                className="flex-shrink-0"
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
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
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <DialogClose asChild>
                                <Button variant="secondary" disabled={isCreating}>
                                    Cancel
                                </Button>
                            </DialogClose>
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
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
