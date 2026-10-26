import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";

// Settings › Offers. The owner's agent saves through the same mutations (community.offer.*).

export type CommunityOfferPrice = {
  price_point_id: string;
  billing_period: "monthly" | "annual";
  amount_base_units: number;
  currency: string;
  currency_decimals: number;
};

export type CommunityBuilderOffer = {
  key: string;
  name: string;
  blurb: string | null;
  rank: number;
  is_base: boolean;
  show_on_sales_page: boolean;
  archived: boolean;
  saved: boolean;
  price: CommunityOfferPrice | null;
  members: number;
};

export type CommunityBuilderOffers = {
  offers: CommunityBuilderOffer[];
  channels: Array<{ id: string; name: string; access_mode: string; offer_audience: string[] }>;
  limits: { offers: number; nameLength: number; blurbLength: number };
};

export async function fetchCloudCommunityOffers<SessionT>(params: { session: SessionT; communityId: string }) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.query(api.communityOffers.listCommunityOffers, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
  })) as CommunityBuilderOffers;
}

export async function saveCloudCommunityOffer<SessionT>(params: {
  session: SessionT;
  communityId: string;
  key?: string;
  name: string;
  blurb?: string | null;
  showOnSalesPage?: boolean;
  price?: { billingPeriod: "monthly" | "annual"; amountBaseUnits: number } | null;
}) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return (await client.mutation(api.communityOffers.saveCommunityOffer, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    ...(params.key ? { key: params.key } : {}),
    name: params.name,
    ...(params.blurb !== undefined ? { blurb: params.blurb } : {}),
    ...(params.showOnSalesPage !== undefined ? { showOnSalesPage: params.showOnSalesPage } : {}),
    ...(params.price !== undefined ? { price: params.price } : {}),
  })) as { key: string };
}

export async function setCloudCommunityOfferArchived<SessionT>(params: { session: SessionT; communityId: string; key: string; archived: boolean }) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return await client.mutation(api.communityOffers.setCommunityOfferArchived, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    key: params.key,
    archived: params.archived,
  });
}

export async function setCloudCommunityChannelOfferAudience<SessionT>(params: { session: SessionT; communityId: string; channelId: string; offerKeys: string[] }) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(params.session);
  return await client.mutation(api.communityOffers.setCommunityChannelOfferAudience, {
    authSubject,
    communityId: params.communityId as Id<"communities">,
    channelId: params.channelId as Id<"communityChannels">,
    offerKeys: params.offerKeys,
  });
}

export function formatCommunityOfferPrice(price: CommunityOfferPrice | null): string {
  if (!price) return "No price";
  const amount = price.amount_base_units / 10 ** price.currency_decimals;
  const text = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  return `${text} / ${price.billing_period === "annual" ? "year" : "month"}`;
}
