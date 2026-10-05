// Per-seat prices for the Team plan. Annual billing is two months free.
export const TEAM_MONTHLY_PRICE_PER_SEAT = 40;
export const TEAM_YEARLY_PRICE_PER_SEAT = TEAM_MONTHLY_PRICE_PER_SEAT * 10;

export type TeamInterval = "month" | "year";

export const teamPriceTotal = (seats: number, interval: TeamInterval): number =>
    seats * (interval === "month" ? TEAM_MONTHLY_PRICE_PER_SEAT : TEAM_YEARLY_PRICE_PER_SEAT);
