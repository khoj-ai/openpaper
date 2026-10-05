import { Badge } from "@/components/ui/badge";
import { Team } from "@/lib/schema";

export function TeamStatusBadge({ team }: { team: Team }) {
    if (team.is_paid && team.cancel_at_period_end) {
        return <Badge variant="outline">Ending</Badge>;
    }
    if (team.is_paid) {
        return <Badge>Active</Badge>;
    }
    if (team.status === "past_due") {
        return <Badge variant="destructive">Payment failed</Badge>;
    }
    if (team.status === "canceled") {
        return <Badge variant="outline">Canceled</Badge>;
    }
    return <Badge variant="outline">Not set up</Badge>;
}
