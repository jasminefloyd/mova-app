export const TRIAL_OFFER_KEY = 'mova_trial_offer_shown';
/** Whether to send the stylist to T1 now: offered by the server, not already there or on Plan, not yet shown this session. */
export function offerTrialNow(shouldOffer: boolean, pathname: string, shownFor: string | null, businessId: string) {
  return shouldOffer && !/\/(start-trial|settings\/plan)\/?$/.test(pathname) && shownFor !== businessId;
}
