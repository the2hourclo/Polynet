import { useCallback, useEffect, useMemo, useState } from "react";

import {
  communityOfferUpgradeErrorMessage,
  fetchCloudCommunityVisitorOffers,
  formatCommunityOfferPrice,
  startCloudCommunityOfferUpgrade,
  type CommunityVisitorOffer,
  type CommunityVisitorOffers,
} from "../../../../shared/cloudCommunityOffersGateway";
import type { CommunityBillingPeriod } from "../../../../shared/communityTypes";
import type { AuthSession } from "../auth";
import "./WebCommunityOfferChooser.css";

// The sales page's "Choose your offer": the offers on sale as cards, lowest
// first, like a plan picker. One button acts on the picked card. With one
// offer (the usual case) nothing here shows and the page is as before.

export type CommunityOfferChoice = {
  offers: CommunityVisitorOffer[];
  selected: CommunityVisitorOffer | null;
  current: CommunityVisitorOffer | null;
  onSelect: (key: string) => void;
  /** Null when the picked card needs the page's usual join or enter button. */
  button: { label: string; disabled: boolean; onClick: () => void } | null;
  note: string | null;
};

export function useCommunityOfferChoice(params: {
  communityId: string | null | undefined;
  session: AuthSession | null;
  preferredPeriod: CommunityBillingPeriod | null;
  onStartOfferCheckout?: (offerKey: string, billingPeriod: CommunityBillingPeriod) => void;
  navigateToUrl?: (url: string) => void;
}): CommunityOfferChoice {
  const { communityId, session } = params;
  const [data, setData] = useState<CommunityVisitorOffers | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!communityId) { setData(null); return; }
    let live = true;
    void fetchCloudCommunityVisitorOffers({ session, communityId })
      .then((next) => { if (live) setData(next); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [communityId, session, reload]);

  const offers = useMemo(() => data?.offers ?? [], [data]);
  const current = offers.find((offer) => offer.key === data?.current_offer_key) ?? null;
  const selected = offers.find((offer) => offer.key === selectedKey) ?? current ?? offers[0] ?? null;
  const onSelect = useCallback((key: string) => { setSelectedKey(key); setNote(null); }, []);

  const upgrade = useCallback(async (offer: CommunityVisitorOffer) => {
    if (!session || !communityId) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await startCloudCommunityOfferUpgrade({ session, communityId, offerKey: offer.key });
      if (result.status === "upgraded") {
        setNote(`You're on ${offer.name} now. Everything it opens is ready.`);
        setReload((value) => value + 1);
      } else if (result.status === "payment_needed") {
        if (result.invoice_url && params.navigateToUrl) params.navigateToUrl(result.invoice_url);
        else setNote("Your card needs a quick check. Pay the invoice we just emailed you, and the upgrade goes through.");
      } else {
        params.onStartOfferCheckout?.(offer.key, periodFor(offer, params.preferredPeriod));
      }
    } catch (error) {
      setNote(communityOfferUpgradeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [communityId, params, session]);

  if (offers.length < 2 || !selected) return { offers: [], selected: null, current: null, onSelect, button: null, note: null };

  let button: CommunityOfferChoice["button"] = null;
  if (current) {
    // A member: moving up happens here; their own offer (or a lower one) needs nothing.
    if (selected.rank > current.rank) {
      button = data?.can_upgrade_here
        ? { label: busy ? "Upgrading…" : `Upgrade to ${selected.name}`, disabled: busy, onClick: () => void upgrade(selected) }
        : { label: `Ask the owner for ${selected.name}`, disabled: true, onClick: () => {} };
    }
  } else if (!selected.is_base) {
    button = { label: `Join with ${selected.name}`, disabled: !params.onStartOfferCheckout,
      onClick: () => params.onStartOfferCheckout?.(selected.key, periodFor(selected, params.preferredPeriod)) };
  }
  const askOwner = Boolean(current && selected.rank > current.rank && !data?.can_upgrade_here);
  return { offers, selected, current, onSelect, button,
    note: note ?? (askOwner ? "Your access was given by the owner, so they change your offer. Send them a message." : null) };
}

function periodFor(offer: CommunityVisitorOffer, preferred: CommunityBillingPeriod | null): CommunityBillingPeriod {
  return offer.prices.find((price) => price.billing_period === preferred)?.billing_period ?? offer.prices[0]?.billing_period ?? "monthly";
}

export function WebCommunityOfferChooser(props: { choice: CommunityOfferChoice; preferredPeriod: CommunityBillingPeriod | null }) {
  const { choice } = props;
  const shown = choice.offers.length > 0;
  // Settings › Offers links here with #offers.
  useEffect(() => {
    if (!shown || typeof window === "undefined" || window.location.hash !== "#offers") return;
    document.getElementById("offers")?.scrollIntoView({ block: "center" });
  }, [shown]);
  if (!shown) return null;
  return (
    <fieldset className="pn-offer-chooser" id="offers">
      <legend>Choose your offer</legend>
      {choice.offers.map((offer, index) => {
        const price = offer.prices.find((item) => item.billing_period === props.preferredPeriod) ?? offer.prices[0] ?? null;
        const below = index > 0 ? choice.offers[index - 1] : null;
        const isCurrent = choice.current?.key === offer.key;
        return (
          <label key={offer.key} className={`pn-offer-choice${choice.selected?.key === offer.key ? " is-selected" : ""}`}>
            <input type="radio" name="pn-offer-choice" checked={choice.selected?.key === offer.key} onChange={() => choice.onSelect(offer.key)} />
            <span className="pn-offer-choice-body">
              <span className="pn-offer-choice-head">
                <strong>{offer.name}</strong>
                {isCurrent ? <span className="pn-offer-choice-tag">Your offer</span> : null}
              </span>
              {below ? <span className="pn-offer-choice-plus">Everything in {below.name}, plus</span> : null}
              {offer.blurb ? <span className="pn-offer-choice-blurb">{offer.blurb}</span> : null}
            </span>
            <span className="pn-offer-choice-price">{price ? formatCommunityOfferPrice(price) : ""}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
