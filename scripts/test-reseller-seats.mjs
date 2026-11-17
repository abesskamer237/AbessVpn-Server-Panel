import assert from 'node:assert/strict';
import {hasResellerPlace,resellerPlaceStatus} from '../modules/reseller-seats.js';

const now=Date.parse('2026-11-17T12:00:00Z');
const users=[
  {id:'root',role:'RESELLER',seatLimit:5},
  {id:'child',role:'RESELLER',parentId:'root',seatLimit:2},
  {id:'grandchild',role:'RESELLER',parentId:'child',seatLimit:1},
  {id:'legacy-root',role:'RESELLER'},
  {id:'legacy-child',role:'RESELLER',parentId:'legacy-root'},
  {id:'zero',role:'RESELLER',seatLimit:0},
];
const accounts=[
  {resellerId:'root',expiresAt:'2026-12-01T00:00:00Z'},
  {resellerId:'root',expiresAt:'2026-01-01T00:00:00Z'},
  {resellerId:'child',expiresAt:'2026-12-01T00:00:00Z'},
  {resellerId:'grandchild',expiresAt:'2026-12-01T00:00:00Z'},
];

const root=resellerPlaceStatus('root',users,accounts,now);
assert.deepEqual(root,{placeLimit:5,placesDirect:1,placesDelegated:2,placesUsed:3,placesAvailable:2});
const child=resellerPlaceStatus('child',users,accounts,now);
assert.deepEqual(child,{placeLimit:2,placesDirect:1,placesDelegated:1,placesUsed:2,placesAvailable:0});
assert.equal(hasResellerPlace('root',users,accounts,now),true);
assert.equal(hasResellerPlace('child',users,accounts,now),false);
assert.equal(resellerPlaceStatus('zero',users,accounts,now).placesAvailable,0);
assert.equal(hasResellerPlace('zero',users,accounts,now),false);

// A legacy child beneath a newly limited parent cannot silently become unlimited.
const legacyUnderLimited=[...users,{id:'limited-parent',role:'RESELLER',seatLimit:4},{id:'legacy-limited-child',role:'RESELLER',parentId:'limited-parent'}];
const legacyChild=resellerPlaceStatus('legacy-limited-child',legacyUnderLimited,[],now);
assert.equal(legacyChild.placeLimit,0);
assert.equal(legacyChild.placesAvailable,0);

// Legacy reseller hierarchies without finite limits remain unlimited.
assert.equal(resellerPlaceStatus('legacy-root',users,accounts,now).placeLimit,null);
assert.equal(resellerPlaceStatus('legacy-child',users,accounts,now).placeLimit,null);
assert.equal(hasResellerPlace('legacy-root',users,accounts,now),true);

console.log('Reseller places passed: direct customer usage, expiry release, hierarchical reservations, zero places, legacy compatibility.');
