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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export interface ColumnDefinition {
    id: string;
    label: string;
    type: 'string' | 'number';
}

interface DataTableSchemaModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (columns: ColumnDefinition[]) => void;
    isCreating?: boolean;
}

export default function DataTableSchemaModal({
    open,
    onOpenChange,
    onSubmit,
    isCreating = false
}: DataTableSchemaModalProps) {
    const [columns, setColumns] = useState<ColumnDefinition[]>([
        { id: '1', label: '', type: 'string' }
    ]);

    const addColumn = () => {
        const newId = (Math.max(...columns.map(c => parseInt(c.id)), 0) + 1).toString();
        setColumns([...columns, { id: newId, label: '', type: 'string' }]);
    };

    const removeColumn = (id: string) => {
        if (columns.length > 1) {
            setColumns(columns.filter(col => col.id !== id));
        }
    };

    const updateColumn = (id: string, field: 'label' | 'type', value: string) => {
        setColumns(columns.map(col =>
            col.id === id ? { ...col, [field]: value } : col
        ));
    };

    const handleSubmit = () => {
        const validColumns = columns.filter(col => col.label.trim() !== '');
        if (validColumns.length === 0) {
            return;
        }
        onSubmit(validColumns);
        // Reset state
        setColumns([{ id: '1', label: '', type: 'string' }]);
    };

    const canSubmit = columns.some(col => col.label.trim() !== '');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Define Data Table Schema</DialogTitle>
                    <DialogDescription>
                        Create a custom data table by defining columns. The AI will extract this information from each paper in your project.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-4">
                    <div className="space-y-3">
                        {columns.map((column, index) => (
                            <div key={column.id} className="flex gap-2 items-end">
                                <div className="flex-1">
                                    <Label htmlFor={`label-${column.id}`} className="text-sm font-medium">
                                        Column {index + 1} Label
                                    </Label>
                                    <Input
                                        id={`label-${column.id}`}
                                        placeholder="e.g., Author, Year, Sample Size, Key Finding..."
                                        value={column.label}
                                        onChange={(e) => updateColumn(column.id, 'label', e.target.value)}
                                        className="mt-1"
                                    />
                                </div>
                                <div className="w-32">
                                    <Label htmlFor={`type-${column.id}`} className="text-sm font-medium">
                                        Type
                                    </Label>
                                    <Select
                                        value={column.type}
                                        onValueChange={(value) => updateColumn(column.id, 'type', value as 'string' | 'number')}
                                    >
                                        <SelectTrigger id={`type-${column.id}`} className="mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="string">String</SelectItem>
                                            <SelectItem value="number">Number</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {columns.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeColumn(column.id)}
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
                        onClick={addColumn}
                        className="w-full"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Column
                    </Button>

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-md p-3">
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                            <strong>Tip:</strong> Be specific with column labels for better results. For example, use &quot;Sample Size (n)&quot; instead of just &quot;Size&quot;.
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
            </DialogContent>
        </Dialog>
    );
}
