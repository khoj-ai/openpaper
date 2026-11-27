"use client"

import { useState } from "react";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/hooks/useSubscription";
import { BarChart3, CreditCard, GraduationCap, MailCheck } from "lucide-react";
import { formatPrice, perSeatMonthly, TeamInterval, TeamPricing, teamPriceTotal } from "./teamPricing";

const VALUE_POINTS = [
    {
        icon: CreditCard,
        title: "One bill for the whole lab",
        body: "Pay with one card, yearly or monthly. Add people mid-year and the difference is prorated.",
    },
    {
        icon: MailCheck,
        title: "Nothing for students to set up",
        body: "They accept an email invite and they're covered: no card, no reimbursement form.",
    },
    {
        icon: BarChart3,
        title: "See that it's being used",
        body: "Who's active each week, how many papers they've opened, how many questions they've asked. The numbers you need at renewal time.",
    },
    {
        icon: GraduationCap,
        title: "Seats outlast a cohort",
        body: "When someone graduates, give their seat to the next student. They keep their own papers and projects.",
    },
];

const FAQ = [
    {
        q: "Can I pay with a university or grant card?",
        a: "Yes. Checkout takes any card, and the billing page has every invoice for your records.",
    },
    {
        q: "Who needs a seat?",
        a: "Everyone on the team, including you. Seats aren't tied to a person, so you can remove someone and invite someone else into their seat.",
    },
    {
        q: "What happens to someone's work if they leave the team?",
        a: "Nothing. Papers, notes, and projects belong to the person, not the team. They go back to their own plan.",
    },
    {
        q: "Some of my students already pay for Researcher.",
        a: "Once they join, we'll show them a link to cancel their personal plan so nobody pays twice. They keep it until the end of the period they've paid for.",
    },
    {
        q: "Can I add or remove seats later?",
        a: "Any time, from the team page. Stripe prorates the difference on your next invoice.",
    },
];

function SeatComparison({ pricing }: { pricing: TeamPricing }) {
    const { team, researcher } = pricing.limits;
    const rows: [string, string, string][] = [
        ["Papers in your library", team.paper_uploads.toLocaleString(), researcher.paper_uploads.toLocaleString()],
        ["Library storage", formatFileSize(team.knowledge_base_size), formatFileSize(researcher.knowledge_base_size)],
        ["Chat credits per week", team.chat_credits_weekly.toLocaleString(), researcher.chat_credits_weekly.toLocaleString()],
        ["Papers per project", team.project_papers.toLocaleString(), researcher.project_papers.toLocaleString()],
        ["Data tables per week", team.data_tables_weekly.toLocaleString(), researcher.data_tables_weekly.toLocaleString()],
        ["Audio overviews per week", team.audio_overviews_weekly.toLocaleString(), researcher.audio_overviews_weekly.toLocaleString()],
        ["Discover searches per week", team.discover_searches_weekly.toLocaleString(), researcher.discover_searches_weekly.toLocaleString()],
    ];
    return (
        <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-muted/50">
                    <tr>
                        <th className="text-left font-medium p-3">Per seat</th>
                        <th className="text-right font-medium p-3">Team</th>
                        <th className="text-right font-medium p-3 text-muted-foreground">Researcher</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {rows.map(([label, teamValue, researcherValue]) => (
                        <tr key={label}>
                            <td className="p-3">{label}</td>
                            <td className="p-3 text-right font-medium tabular-nums">{teamValue}</td>
                            <td className="p-3 text-right text-muted-foreground tabular-nums">{researcherValue}</td>
                        </tr>
                    ))}
                    <tr>
                        <td className="p-3" colSpan={3}>
                            <span className="text-muted-foreground">Plus everything in Researcher, including model choice and Zotero auto-sync.</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

function CostCalculator({ pricing }: { pricing: TeamPricing }) {
    const [people, setPeople] = useState(8);
    const [interval, setBillingInterval] = useState<TeamInterval>("year");
    const total = teamPriceTotal(pricing, people, interval);
    const yearlySavings = teamPriceTotal(pricing, people, "month") * 12 - teamPriceTotal(pricing, people, "year");

    return (
        <div className="rounded-lg border p-5 space-y-5">
            <div className="flex items-center justify-between gap-4">
                <label htmlFor="calculator-people" className="text-sm font-medium">
                    {people} {people === 1 ? "person" : "people"}, including you
                </label>
                <div className="flex rounded-md border p-0.5 gap-0.5">
                    {(["year", "month"] as const).map((option) => (
                        <Button
                            key={option}
                            size="sm"
                            variant={interval === option ? "default" : "ghost"}
                            className="h-7"
                            onClick={() => setBillingInterval(option)}
                        >
                            {option === "year" ? "Yearly" : "Monthly"}
                        </Button>
                    ))}
                </div>
            </div>
            <input
                id="calculator-people"
                type="range"
                min={1}
                max={30}
                value={people}
                onChange={(e) => setPeople(parseInt(e.target.value, 10))}
                className="w-full accent-primary"
            />
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                    <span className="text-3xl font-semibold tabular-nums">{formatPrice(total)}</span>
                    <span className="text-muted-foreground"> / {interval}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                    {formatPrice(Math.round(perSeatMonthly(pricing, interval) * 100) / 100)} per person a month
                    {interval === "year" && yearlySavings > 0 && ` · saves ${formatPrice(yearlySavings)} a year`}
                </p>
            </div>
        </div>
    );
}

export function TeamLanding({ pricing, onStart }: { pricing: TeamPricing | null; onStart: () => void }) {
    return (
        <div className="space-y-12">
            <section className="space-y-4">
                <h1 className="text-3xl font-bold tracking-tight">Open Paper for your whole lab</h1>
                <p className="text-lg text-muted-foreground max-w-xl">
                    One admin pays for everyone&apos;s seat. Your students, postdocs, and collaborators get the
                    Team plan the moment they accept an invite.
                </p>
                <div className="flex items-center gap-4 flex-wrap">
                    <Button size="lg" onClick={onStart}>Set up your team</Button>
                    {pricing && (
                        <span className="text-sm text-muted-foreground">
                            {formatPrice(Math.round(perSeatMonthly(pricing, "year") * 100) / 100)} per person a month, billed yearly
                        </span>
                    )}
                </div>
            </section>

            <section className="grid gap-6 sm:grid-cols-2">
                {VALUE_POINTS.map(({ icon: Icon, title, body }) => (
                    <div key={title} className="space-y-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <h2 className="font-medium">{title}</h2>
                        <p className="text-sm text-muted-foreground">{body}</p>
                    </div>
                ))}
            </section>

            {pricing && (
                <>
                    <section className="space-y-3">
                        <h2 className="text-lg font-medium">What each seat gets</h2>
                        <SeatComparison pricing={pricing} />
                    </section>
                    <section className="space-y-3">
                        <h2 className="text-lg font-medium">What it costs</h2>
                        <CostCalculator pricing={pricing} />
                    </section>
                </>
            )}

            <section className="space-y-3">
                <h2 className="text-lg font-medium">Questions</h2>
                <Accordion type="single" collapsible className="w-full">
                    {FAQ.map(({ q, a }) => (
                        <AccordionItem key={q} value={q}>
                            <AccordionTrigger className="text-left">{q}</AccordionTrigger>
                            <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </section>

            <section className="rounded-lg bg-muted/50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="font-medium">Ready when you are</h2>
                    <p className="text-sm text-muted-foreground">Name your team, add your people, pay. Invites go out right after.</p>
                </div>
                <Button onClick={onStart}>Set up your team</Button>
            </section>
        </div>
    );
}
