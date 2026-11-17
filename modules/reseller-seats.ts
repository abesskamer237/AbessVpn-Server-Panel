export const MAX_RESELLER_PLACES = 10000;

export type ResellerPlaceUser = {
  id: string;
  role: string;
  parentId?: string;
  seatLimit?: number | null;
};

export type ResellerPlaceAccount = {
  resellerId?: string;
  expiresAt?: string;
};

/**
 * Seat limits reserve customer places across a reseller branch.
 * Direct, unexpired client accounts consume one place; each direct child
 * reserves the full number of places assigned to it. Legacy resellers with
 * no finite seatLimit remain unlimited.
 */
export function resellerPlaceStatus(
  resellerId: string,
  users: ResellerPlaceUser[],
  accounts: ResellerPlaceAccount[],
  now = Date.now(),
) {
  const reseller = users.find(user => user.id === resellerId && user.role === 'RESELLER');
  const placeLimit = typeof reseller?.seatLimit === 'number' ? reseller.seatLimit : null;
  const placesDirect = accounts.filter(account => {
    if (account.resellerId !== resellerId) return false;
    const expiry = Date.parse(account.expiresAt || '');
    return !Number.isFinite(expiry) || expiry > now;
  }).length;
  const placesDelegated = users
    .filter(user => user.role === 'RESELLER' && user.parentId === resellerId)
    .reduce((total, child) => total + (
      Number.isSafeInteger(child.seatLimit) && Number(child.seatLimit) >= 0
        ? Number(child.seatLimit)
        : placeLimit === null ? 0 : placeLimit
    ), 0);
  const placesUsed = placesDirect + placesDelegated;
  return {
    placeLimit,
    placesDirect,
    placesDelegated,
    placesUsed,
    placesAvailable: placeLimit === null ? null : Math.max(0, placeLimit - placesUsed),
  };
}

export function hasResellerPlace(
  resellerId: string,
  users: ResellerPlaceUser[],
  accounts: ResellerPlaceAccount[],
  now = Date.now(),
) {
  const status = resellerPlaceStatus(resellerId, users, accounts, now);
  return status.placeLimit === null || (status.placesAvailable ?? 0) > 0;
}
