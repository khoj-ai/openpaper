"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchFromApi } from "@/lib/api";
import { ChartPlan, PaperItem } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    papers: PaperItem[];
    onCreated: () => Promise<void> | void;
}

export function ChartComposerDialog({ open, onOpenChange, projectId, papers, onCreated }: Props) {
    const [prompt, setPrompt] = useState("");
    const [paperIds, setPaperIds] = useState<string[]>([]);
    const [plan, setPlan] = useState<ChartPlan | null>(null);
    const [loading, setLoading] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);

    useEffect(() => {
        if (open) setPaperIds(papers.map(paper => paper.id));
    }, [open, papers]);

    const propose = async () => {
        if (!prompt.trim() || paperIds.length === 0) return;
        setLoading(true);
        try {
            const response = await fetchFromApi("/api/projects/charts/propose", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project_id: projectId, prompt, paper_ids: paperIds }),
            });
            setPlan(response.plan);
            setGenerationError(null);
        } catch (error) {
            console.error("Failed to propose chart", error);
            toast.error("Could not design a chart from that request.");
        } finally { setLoading(false); }
    };

    const generate = async () => {
        if (!plan) return;
        setGenerationError(null);
        setLoading(true);
        try {
            await fetchFromApi("/api/projects/charts", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project_id: projectId, prompt, paper_ids: paperIds, plan }),
            });
            toast.success("Chart generation started.");
            onOpenChange(false);
            setPlan(null);
            await onCreated();
        } catch (error) {
            setGenerationError(error instanceof Error ? error.message : "Could not create a chart from this plan.");
        } finally { setLoading(false); }
    };

    const updateField = (name: "x" | "y", value: string) => {
        setGenerationError(null);
        if (!plan) return;
        const previous = plan[name];
        const key = value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || previous.key;
        const replacement = { ...previous, key, label: value };
        const hasPreviousField = plan.fields.some(field => field.key === previous.key);
        const fields = hasPreviousField
            ? plan.fields.map(field => field.key === previous.key ? { ...field, key, label: value } : field)
            : [...plan.fields, replacement];
        const calculation = plan.calculation ? {
            ...plan.calculation,
            label: plan.calculation.label === previous.key ? key : plan.calculation.label,
            inputs: plan.calculation.inputs.map(input => input === previous.key ? key : input),
        } : null;
        setPlan({ ...plan, [name]: replacement, fields, calculation });
    };

    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
                <DialogTitle>Create a chart</DialogTitle>
                <DialogDescription>Describe the comparison, then review the chart shape before it searches for cited values.</DialogDescription>
            </DialogHeader>
            {!plan ? <div className="space-y-4">
                <div><Label htmlFor="chart-request">What should the chart show?</Label><Textarea id="chart-request" value={prompt} onChange={event => setPrompt(event.target.value)} className="mt-2" placeholder="Compare sample size against accuracy across these papers" /></div>
                <div><Label>Paper scope</Label><div className="mt-2 max-h-36 space-y-2 overflow-y-auto rounded border p-2">
                    {papers.map(paper => <label key={paper.id} className="flex gap-2 text-sm"><input type="checkbox" checked={paperIds.includes(paper.id)} onChange={() => setPaperIds(ids => ids.includes(paper.id) ? ids.filter(id => id !== paper.id) : [...ids, paper.id])} />{paper.title}</label>)}
                </div></div>
                <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={propose} disabled={loading || !prompt.trim() || paperIds.length === 0}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Design chart</Button></div>
            </div> : <div className="space-y-4">
                <p className="rounded bg-muted p-2 text-xs text-muted-foreground">Review and customize this plan. Generation will search the selected papers and include only directly cited values.</p>
                <div><Label htmlFor="chart-title">Title</Label><Input id="chart-title" className="mt-1" value={plan.title} onChange={event => { setGenerationError(null); setPlan({ ...plan, title: event.target.value }); }} /></div>
                <div><Label>Chart type</Label><Select value={plan.chart_type} onValueChange={(value: ChartPlan["chart_type"]) => { setGenerationError(null); setPlan({ ...plan, chart_type: value }); }}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bar">Bar</SelectItem><SelectItem value="line">Line</SelectItem><SelectItem value="scatter">Scatter</SelectItem></SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="chart-x">X axis</Label><Input id="chart-x" className="mt-1" value={plan.x.label} onChange={event => updateField("x", event.target.value)} /></div><div><Label htmlFor="chart-y">Y axis</Label><Input id="chart-y" className="mt-1" value={plan.y.label} onChange={event => updateField("y", event.target.value)} /></div></div>
                {plan.calculation && <p className="text-xs text-muted-foreground">Calculated y: {plan.calculation.spec}</p>}
                {generationError && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{generationError}</p>}
                <div className="flex justify-between gap-2"><Button variant="ghost" onClick={() => setPlan(null)}>Back</Button><Button onClick={generate} disabled={loading || !plan.title.trim()}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}Generate chart</Button></div>
            </div>}
        </DialogContent>
    </Dialog>;
}
