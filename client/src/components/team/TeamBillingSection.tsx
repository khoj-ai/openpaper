"use client"

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFromApi } from "@/lib/api";
import { Team } from "@/lib/schema";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TeamBillingSectionProps {
    team: Team;
    seatsTaken: number;
    onChanged: () => void;
}

const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

export function TeamBillingSection({ team, seatsTaken, onChanged }: TeamBillingSectionProps) {
    const [seats, setSeats] = useState(Math.max(team.seats, seatsTaken));
    const [saving, setSaving] = useState(false);
    const [openingPortal, setOpeningPortal] = useState(false);

    const seatsValid = Number.isInteger(seats) && seats >= Math.max(1, seatsTaken) && seats <= 500;

    const saveSeats = async () => {
        setSaving(true);
        try {
            await fetchFromApi(`/api/organization/${team.id}/seats`, {
                method: "PUT",
                body: JSON.stringify({ seats }),
            });
            toast.success(`Team now has ${seats} seats. The difference is prorated on your next invoice.`);
            onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not change seats.");
        } finally {
            setSaving(false);
        }
    };

    const openPortal = async () => {
        setOpeningPortal(true);
        try {
            const { url } = await fetchFromApi(`/api/organization/${team.id}/portal`, { method: "POST" });
            window.location.href = url;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not open billing.");
            setOpeningPortal(false);
        }
    };

    const seatsInput = (
        <div className="space-y-2">
            <Label htmlFor="team-seats">Seats</Label>
            <Input
                id="team-seats"
                type="number"
                min={Math.max(1, seatsTaken)}
                max={500}
                value={Number.isNaN(seats) ? "" : seats}
                onChange={(e) => setSeats(parseInt(e.target.value, 10))}
                className="w-28"
            />
        </div>
    );

    return (
        <section className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">Billing</h2>
                <p className="text-sm text-muted-foreground">
                    {seatsTaken} of {team.seats} seats in use, counting pending invitations.
                    {team.current_period_end && (
                        team.cancel_at_period_end
                            ? ` The team plan ends on ${formatDate(team.current_period_end)}.`
                            : ` Renews on ${formatDate(team.current_period_end)}.`
                    )}
                </p>
            </div>

            {team.status === "past_due" && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        The last payment failed, so members are back on the Basic plan until it goes through.
                        Update the payment method in billing.
                    </AlertDescription>
                </Alert>
            )}

            <div className="flex flex-wrap items-end gap-3">
                {seatsInput}
                <Button
                    variant="outline"
                    disabled={!seatsValid || seats === team.seats || saving}
                    onClick={saveSeats}
                >
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update seats
                </Button>
                <Button variant="ghost" onClick={openPortal} disabled={openingPortal}>
                    {openingPortal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Payment method &amp; invoices
                </Button>
            </div>
        </section>
    );
}
